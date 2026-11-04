#!/usr/bin/perl
# Every hash link resolves, every route has somewhere to render, the shop and
# the store stay two separate pages, and the import graph is still a tree.
#
#   perl tools/routes.pl
#
# ---------------------------------------------------------------------------
# TWO PAGES, TWO LINKS, TWO ROUTE TABLES.
#
#   shop   app/index.html   entry app.js     domain.js ROUTES        .../clothes-app/
#   store  app/owner.html   entry owner.js   domain.js OWNER_ROUTES  .../clothes-app/store/
#
# Each page is checked against ITS OWN table, over the modules ITS OWN entry
# actually imports. That is what keeps them apart: a store module pulled into
# the shop registers a screen the shop has no section for, and fails; a store
# tab linked from a shop module matches no shop route, and fails; a link to
# the store page from anywhere in the shop fails by name. Each of those would
# otherwise put the store in front of a customer, and nothing else would see it.
#
# The import-graph check is the one no other checker can see: a circular ES
# import hands you `undefined` for something that looks hoisted and throws at
# render, with a stack trace that points somewhere unrelated. balance.pl cannot
# see it because the brackets are all fine.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;

my $root = $0; $root =~ s{[\x5C/]tools[\x5C/]routes\.pl$}{};
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

# Source with the comments out: a link, an import or a page name DISCUSSED in
# a comment is not one.
sub code {
  my $s = slurp(shift);
  # Replaced by the newlines they held, so a line number still points at the
  # right line.
  $s =~ s{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse;
  $s =~ s{<!--.*?-->}{"\n" x (() = $& =~ /\n/g)}gse;
  $s =~ s{^[ \t]*//[^\n]*}{}gm;
  return $s;
}

sub norm {
  my @o;
  for my $p (split m{/}, shift) {
    next if $p eq '' || $p eq '.';
    if ($p eq '..') { pop @o } else { push @o, $p }
  }
  return join '/', @o;
}

# The modules a page really loads: its entry, and everything reachable from it
# by a static import in either form, or a dynamic import().
sub closure {
  my ($entry) = @_;
  my (%seen, @todo);
  @todo = ($entry);
  while (@todo) {
    my $rel = shift @todo;
    next if $seen{$rel}++;
    die "$rel is imported but does not exist\n" unless -f "$APP/$rel";
    my $src = code("$APP/$rel");
    my @t;
    push @t, $1 while $src =~ /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
    push @t, $1 while $src =~ /^\s*import\s+['"]([^'"]+)['"]\s*;/gm;
    push @t, $1 while $src =~ /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
    (my $dir = $rel) =~ s{[^/]*$}{};
    push @todo, norm("$dir$_") for grep { m{^\.} } @t;
  }
  return sort keys %seen;
}

my $dom = slurp("$APP/domain.js");
sub table {
  my ($name) = @_;
  my ($block) = $dom =~ /export const $name = \[(.*?)\n\];/s
    or die "could not find $name in domain.js\n";
  my (%screens, @patterns);
  $screens{$1} = 1 while $block =~ /screen:\s*'([a-z]+)'/g;
  while ($block =~ /re:\s*(\/[^,]+?\/)\s*,/g) {
    my $p = $1;
    $p =~ s{^/|/$}{}g;
    # Plain JS regex literals with no flags; Perl reads them as they are,
    # apart from the escaped forward slashes.
    $p =~ s{\x5C/}{/}g;
    push @patterns, $p;
  }
  my $n = () = $block =~ /\{\s*re:/g;
  return { screens => \%screens, patterns => \@patterns, n => $n };
}

sub resolves {
  my ($path, $t) = @_;
  for my $re (@{ $t->{patterns} }) { return 1 if eval { $path =~ /$re/ } }
  return 0;
}

# What the catalogue really holds, so a link to a category that does not exist
# fails here -- the shape of a link copied in from another shop.
my $cats = decode_json(do { local $/; open my $f, '<:raw', "$APP/data/categories.json" or die; <$f> });
my $catl = decode_json(do { local $/; open my $f, '<:raw', "$APP/data/catalog.json" or die; <$f> });
my (%CAT, %SUB, %PROD);
for my $c (@{ $cats->{categories} }) {
  $CAT{ $c->{slug} } = 1;
  $SUB{"$c->{slug}/$_->{slug}"} = 1 for @{ $c->{sub} || [] };
}
$PROD{ $_->{slug} } = 1 for @{ $catl->{products} };

# The store's tab bar and its route table name the same tabs. A tab missing
# from the table is a tab that opens the not-found screen; one missing from the
# bar is a page nobody can reach.
{
  my ($tabs) = slurp("$APP/pages/admin.js") =~ /const TABS = \[(.*?)\n\];/s
    or die "could not find TABS in pages/admin.js\n";
  my %bar = map { $_ => 1 } ($tabs =~ /id:\s*'([a-z-]+)'/g);
  my ($alt) = $dom =~ /export const OWNER_ROUTES = \[.*?\(((?:[a-z-]+\|)+[a-z-]+)\)/s
    or die "could not find the tab list in OWNER_ROUTES\n";
  my %tbl = map { $_ => 1 } split /\|/, $alt;
  my @only_bar = grep { !$tbl{$_} } sort keys %bar;
  my @only_tbl = grep { !$bar{$_} } sort keys %tbl;
  fail("store tab '$_' is in TABS but not in OWNER_ROUTES -- it opens the not-found screen") for @only_bar;
  fail("store tab '$_' is in OWNER_ROUTES but not in TABS -- nothing links to it") for @only_tbl;
  ok(scalar(keys %bar) . ' store tabs, the same in the tab bar and the route table')
    unless @only_bar || @only_tbl;
}

my @PAGES = (
  { name => 'shop',  html => 'index.html', entry => 'app.js',   table => 'ROUTES' },
  { name => 'store', html => 'owner.html', entry => 'owner.js', table => 'OWNER_ROUTES' },
);

my (%LOADS, @summary);
my ($links, $bad, $catlinks, $catbad, $regbad) = (0, 0, 0, 0, 0);

for my $pg (@PAGES) {
  my $t    = table($pg->{table});
  my @mods = closure($pg->{entry});
  $LOADS{ $pg->{name} } = { map { $_ => 1 } @mods };
  my $html = code("$APP/$pg->{html}");
  my $P    = "$pg->{name} ($pg->{html})";

  # 1. The route table, and the sections it needs.
  my @ids = ($html =~ /data-screen="([a-z]+)"/g);
  my %sections = map { $_ => 1 } @ids;
  # Duplicate section ids would make router.js show two at once.
  my %seen; my @dupe = grep { $seen{$_}++ } @ids;
  fail("$P: duplicate data-screen sections: " . join(', ', @dupe)) if @dupe;
  for my $s (sort keys %{ $t->{screens} }) {
    fail("$P: route screen '$s' has no <section data-screen=\"$s\">") unless $sections{$s};
  }
  # notfound is reached by falling through parseRoute, not by a route entry.
  for my $s (sort keys %sections) {
    next if $s eq 'notfound';
    fail("$P: a section for '$s' that no $pg->{table} entry points at") unless $t->{screens}{$s};
  }
  fail("$P: no notfound section, so a bad link would show nothing") unless $sections{notfound};

  # 2. Every section is registered exactly once by a module THIS page loads,
  #    and nothing it loads registers a screen it has no section for. The
  #    second half is what catches a store module imported into the shop.
  my %reg;
  for my $m (@mods) {
    my $src = code("$APP/$m");
    while ($src =~ /registerScreen\s*\(\s*'([a-z]+)'/g) {
      if ($reg{$1}) { $regbad++; fail("$P: screen '$1' is registered twice, by app/$reg{$1} and app/$m"); }
      $reg{$1} = $m;
    }
  }
  for my $s (sort keys %sections) {
    unless ($reg{$s}) { $regbad++; fail("$P: nothing it loads registers the '$s' screen"); }
  }
  for my $s (sort keys %reg) {
    next if $sections{$s};
    $regbad++;
    fail("$P loads app/$reg{$s}, which registers '$s' -- a screen this page has no "
       . 'section for, so that module does not belong on this page');
  }

  # 3. Every #/... literal resolves against THIS page's table. A mistyped link
  #    is invisible until somebody clicks it, and then it shows the not-found
  #    screen -- which looks like a design and not a typo.
  for my $rel (@mods, $pg->{html}) {
    my @lines = split /\n/, ($rel eq $pg->{html} ? $html : code("$APP/$rel"));
    for my $i (0 .. $#lines) {
      # Only genuine literals: href="#/x" or go('#/x'). A template hole like
      # #/p/${slug} is not something this can resolve, and is skipped.
      while ($lines[$i] =~ /["'](#\/[A-Za-z0-9\/_-]*)["']/g) {
        my $h = $1;
        $links++;
        (my $path = $h) =~ s/^#//;
        unless (resolves($path, $t)) {
          $bad++;
          fail("$P: app/$rel:" . ($i + 1) . " link $h matches no $pg->{table} entry");
          next;
        }
        # 4. ...and the category or product it names exists.
        next unless $pg->{name} eq 'shop';
        if ($path =~ m{^/c/([a-z0-9-]+)(?:/([a-z0-9-]+))?$}) {
          $catlinks++;
          next if defined $2 ? $SUB{"$1/$2"} : $CAT{$1};
          $catbad++;
          fail("app/$rel:" . ($i + 1) . " link $h names a category categories.json does not have");
        } elsif ($path =~ m{^/p/([a-z0-9-]+)$}) {
          $catlinks++;
          next if $PROD{$1};
          $catbad++;
          fail("app/$rel:" . ($i + 1) . " link $h names a product catalog.json does not have");
        }
      }
    }
  }
  my $ns = keys %{ $t->{screens} };
  push @summary, "$pg->{name} $t->{n} routes, $ns screen" . ($ns == 1 ? '' : 's')
    . ', ' . scalar(@mods) . ' modules';
}
ok(join('; ', @summary));
ok('every section on each page is registered once, by a module that page loads') unless $regbad;
ok("$links hash links, each resolving against its own page's table") unless $bad;
ok("$catlinks links to a category or product, each naming one that exists") unless $catbad;

# ---------------------------------------------------------------------------
# 5. THE SHOP AND THE STORE STAY APART.
#
# The shop is what every customer downloads. It must carry no store module and
# no way into the store page: the store is reached by its own link only.
# ---------------------------------------------------------------------------
my @leak;
for my $m (sort keys %{ $LOADS{shop} }) {
  push @leak, "it loads app/$m, a store module"
    if $m =~ m{^(?:owner\.js|pages/admin(?:-[a-z]+)?\.js)$};
}
for my $rel ((sort keys %{ $LOADS{shop} }), 'index.html') {
  my $src = code("$APP/$rel");
  push @leak, "app/$rel names the store page" if $src =~ /\bowner\.(?:html|js)\b/;
  push @leak, "app/$rel links to the store/ door" if $src =~ m{["'](?:\.\.?/)*store/};
}
push @leak, 'the root index.html names the store page'
  if code("$root/index.html") =~ m{\bowner\.html\b|["'](?:\.\.?/)*store/};
if (@leak) { fail("the shop reaches the store: $_") for @leak; }
else { ok('the shop loads no store module and links nowhere near the store page'); }

# ---------------------------------------------------------------------------
# 6. THE IMPORT GRAPH IS A TREE.
#
# ui.js and router.js are imported BY the pages. If either imports a page
# back, the cycle is silent until render.
# ---------------------------------------------------------------------------
my $treebad = 0;
for my $rel ('/ui.js', '/router.js', '/sidebar.js', '/components.js') {
  my $src = slurp("$APP$rel");
  $src =~ s{/\*.*?\*/}{}gs;

  # ⚠️ BOTH forms. `import x from './y.js'` AND the bare side-effect form
  # `import './y.js'` -- which is exactly how every page module is pulled in,
  # so a cycle introduced that way is the likely one. An earlier version of
  # this check only matched the `from` clause and silently missed it.
  my @targets;
  push @targets, $1 while $src =~ /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm;
  push @targets, $1 while $src =~ /^\s*import\s+['"]([^'"]+)['"]\s*;/gm;

  for my $t (@targets) {
    next unless $t =~ m{pages/};
    $treebad++;
    fail("app$rel imports a page module ($t) -- the import graph must stay a "
       . 'tree; pages import these, never the other way round');
  }
}
# router.js must not import ui.js either: ui.js imports store.js and brand.js,
# and router.js is imported by every page.
my $r = slurp("$APP/router.js");
$r =~ s{/\*.*?\*/}{}gs;
if ($r =~ /from\s+['"]\.\/ui\.js['"]/) { $treebad++; fail('router.js imports ui.js'); }
ok('the import graph is a tree -- no shell module imports a page') unless $treebad;

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all route checks passed\n";
exit 0;
