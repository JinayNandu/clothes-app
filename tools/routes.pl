#!/usr/bin/perl
# Every hash link resolves, every route has somewhere to render, and the
# import graph is still a tree.
#
#   perl tools/routes.pl
#
# The last of those is the one no other checker can see: a circular ES module
# import hands you `undefined` for something that looks hoisted and throws at
# render, with a stack trace that points somewhere unrelated. balance.pl cannot
# see it because the brackets are all fine.
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]routes\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

sub slurp {
  my ($p) = @_;
  open my $fh, '<:encoding(UTF-8)', $p or die "cannot read $p: $!\n";
  local $/; my $t = <$fh>; close $fh;
  return $t;
}

my @FILES;
for my $dir ('', '/pages') {
  opendir my $dh, "$APP$dir" or next;
  push @FILES, map { "$dir/$_" } sort grep { /\.js$/ } readdir $dh;
  closedir $dh;
}

my $dom  = slurp("$APP/domain.js");
my $html = slurp("$APP/index.html");

# ---------------------------------------------------------------------------
# 1. The route table, and the sections it needs.
# ---------------------------------------------------------------------------
my ($block) = $dom =~ /export const ROUTES = \[(.*?)\n\];/s
  or die "could not find ROUTES in domain.js\n";

my %screens;
$screens{$1} = 1 while $block =~ /screen:\s*'([a-z]+)'/g;
my $nroutes = () = $block =~ /\{\s*re:/g;
ok("$nroutes routes over " . scalar(keys %screens) . ' screens');

my %sections;
$sections{$1} = 1 while $html =~ /data-screen="([a-z]+)"/g;

# Duplicate section ids would make router.js show two at once.
my @ids = ($html =~ /data-screen="([a-z]+)"/g);
my %seen; my @dupe = grep { $seen{$_}++ } @ids;
fail('duplicate data-screen sections: ' . join(', ', @dupe)) if @dupe;

for my $s (sort keys %screens) {
  fail("route screen '$s' has no <section data-screen=\"$s\"> in index.html")
    unless $sections{$s};
}
# notfound is reached by falling through parseRoute, not by a route entry.
for my $s (sort keys %sections) {
  next if $s eq 'notfound';
  fail("index.html has a section for '$s' that no route points at")
    unless $screens{$s};
}

# ---------------------------------------------------------------------------
# 2. Every screen is registered by exactly one module.
# ---------------------------------------------------------------------------
my %registered;
for my $rel (@FILES) {
  my $src = slurp("$APP$rel");
  $src =~ s{/\*.*?\*/}{}gs;
  while ($src =~ /registerScreen\s*\(\s*'([a-z]+)'/g) {
    fail("screen '$1' is registered twice: $registered{$1} and app$rel")
      if $registered{$1};
    $registered{$1} = "app$rel";
  }
}
for my $s (sort keys %sections) {
  fail("no module registers the '$s' screen") unless $registered{$s};
}
ok(scalar(keys %registered) . ' screens, each registered exactly once')
  unless $fails;

# ---------------------------------------------------------------------------
# 3. Every #/... literal in the source resolves against the route table.
#
# A mistyped link is invisible until somebody clicks it, and then it shows the
# not-found screen -- which looks like a deliberate design and not a typo.
# ---------------------------------------------------------------------------
my @patterns;
while ($block =~ /re:\s*(\/[^,]+?\/)\s*,/g) {
  my $p = $1;
  $p =~ s{^/|/$}{}g;
  push @patterns, $p;
}

sub resolves {
  my ($path) = @_;
  for my $p (@patterns) {
    my $re = $p;
    # The patterns are plain JS regex literals with no flags; Perl reads them
    # as-is apart from the escaped forward slashes.
    $re =~ s{\\/}{/}g;
    return 1 if eval { $path =~ /$re/ };
  }
  return 0;
}

my ($links, $bad) = (0, 0);
for my $rel (@FILES, '/index.html') {
  my $src = slurp("$APP$rel");
  $src =~ s{/\*.*?\*/}{}gs;
  $src =~ s{<!--.*?-->}{}gs;
  my @lines = split /\n/, $src;
  for my $i (0 .. $#lines) {
    # Only genuine literals: href="#/x" or go('/x'). A template hole like
    # #/p/${slug} is not something this can resolve, and is skipped.
    while ($lines[$i] =~ /["'](#\/[A-Za-z0-9\/_-]*)["']/g) {
      my $h = $1;
      next if $h =~ /\$\{/;
      $links++;
      my $path = $h; $path =~ s/^#//; $path =~ s/\?.*$//;
      next if resolves($path);
      $bad++;
      fail("app$rel:" . ($i + 1) . " link $h matches no route");
    }
  }
}
ok("$links hash links, all resolve") unless $bad;

# ---------------------------------------------------------------------------
# 4. THE IMPORT GRAPH IS A TREE.
#
# ui.js and router.js are imported BY the pages. If either imports a page
# back, the cycle is silent until render.
# ---------------------------------------------------------------------------
for my $rel ('/ui.js', '/router.js', '/sidebar.js', '/components.js') {
  my $src = slurp("$APP$rel");
  $src =~ s{/\*.*?\*/}{}gs;

  # ⚠️ BOTH forms. `import x from './y.js'` AND the bare side-effect form
  # `import './y.js'` -- which is exactly how every page module is pulled in,
  # so a cycle introduced that way is the likely one. An earlier version of
  # this check only matched the `from` clause and silently missed it.
  my @targets;
  push @targets, $1 while $src =~ /^\s*import\s[^;]*?from\s+'([^']+)'/gm;
  push @targets, $1 while $src =~ /^\s*import\s+'([^']+)'\s*;/gm;

  for my $t (@targets) {
    fail("app$rel imports a page module ($t) -- the import graph must stay a "
       . 'tree; pages import these, never the other way round')
      if $t =~ m{pages/};
  }
}
# router.js must not import ui.js either: ui.js imports store.js and brand.js,
# and router.js is imported by every page.
my $r = slurp("$APP/router.js");
$r =~ s{/\*.*?\*/}{}gs;
fail('router.js imports ui.js') if $r =~ /from\s+'\.\/ui\.js'/;
ok('the import graph is a tree -- no shell module imports a page') unless $fails;

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all route checks passed\n";
exit 0;
