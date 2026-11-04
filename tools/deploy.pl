#!/usr/bin/perl
# The deployed path: what GitHub Pages serves, and nothing local exercises.
#
#   perl tools/deploy.pl
#
# tools/serve.pl serves app/ AS the root, so on this machine there is no root
# redirect to drop a hash, no subpath for a root-relative URL to miss, and no
# case-sensitive filesystem to 404 a mis-cased import. Each of those breaks
# only on the live site -- the one copy nobody tests by hand -- which is why
# this reads the files instead of trusting a local click-through. Every rule
# here is one that kirana/DEPLOY.md learned by something breaking.
use strict;
use warnings;

my $root = $0; $root =~ s{[\x5C/]tools[\x5C/]deploy\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

sub slurp {
  my ($p) = @_;
  open my $fh, '<:encoding(UTF-8)', $p or return undef;
  local $/; my $t = <$fh>; close $fh;
  return $t;
}

# ---------------------------------------------------------------------------
# 1. The files at the root that make Pages serve this exactly as it is.
# ---------------------------------------------------------------------------
if (-e "$root/.nojekyll") {
  ok('.nojekyll is at the repository root');
} else {
  fail('.nojekyll is missing -- without it GitHub runs the files through Jekyll, '
     . 'which silently refuses to serve any name that begins with an underscore');
}

my $ga = slurp("$root/.gitattributes") // '';
if ($ga =~ /^\*\s+text=auto\s+eol=lf\b/m) {
  ok('.gitattributes normalises every text file to LF');
} else {
  fail('.gitattributes no longer pins eol=lf -- a CRLF shebang breaks tools/*.pl '
     . 'on every machine but the one that wrote it');
}

my $ri = slurp("$root/index.html");
if (!defined $ri) {
  fail('no index.html at the repository root -- the short Pages URL would 404 '
     . 'instead of opening the shop');
} else {
  # The hash is the point. This shop routes on it -- a product link is
  # .../clothes-app/#/p/<slug> -- so a redirect that keeps the query and drops
  # the hash turns every product link anybody shares into the home page.
  if ($ri =~ /location\.replace\(\s*(["'])\.\/app\/\1\s*\+\s*location\.search\s*\+\s*location\.hash\s*\)/) {
    ok('the root page forwards into app/ carrying the query AND the hash');
  } else {
    fail('the root page no longer forwards with '
       . 'location.replace("./app/" + location.search + location.hash) -- '
       . 'a shared product link would land on the home page');
  }
  if ($ri =~ /<meta\s+http-equiv=["']refresh["']\s+content=["']0;\s*url=\.\/app\/["']/i) {
    ok('the root page keeps its <meta refresh> fallback for scripts off');
  } else {
    fail('the root page has lost its <meta refresh> fallback to ./app/');
  }
}

# ---------------------------------------------------------------------------
# 2. Every path in the app is relative, and matches its file EXACTLY.
#
# A root-relative URL works on serve.pl, which serves app/ as "/", and 404s
# under /clothes-app/app/. A mis-cased one works on Windows, which answers for
# any casing, and 404s on Pages, which does not. Neither shows up locally.
# ---------------------------------------------------------------------------
my @files;
sub walk {
  my ($dir) = @_;
  opendir my $dh, $dir or return;
  for my $e (sort readdir $dh) {
    next if $e =~ /^\./;
    my $p = "$dir/$e";
    if (-d $p) { walk($p) }
    elsif ($e =~ /\.(?:js|html|css)$/) { push @files, $p }
  }
  closedir $dh;
}
walk($APP);

# -e is no use for the case test: on Windows it says yes to any casing. So walk
# the path a component at a time against what each directory really lists.
sub exact {
  my ($path) = @_;
  my $dir = $root;
  for my $part (split m{/}, $path) {
    opendir my $dh, $dir or return 0;
    my %have = map { $_ => 1 } readdir $dh;
    closedir $dh;
    return 0 unless $have{$part};
    $dir = "$dir/$part";
  }
  return 1;
}

sub norm {
  my @o;
  for my $p (split m{/}, shift) {
    next if $p eq '' || $p eq '.';
    if ($p eq '..') { pop @o } else { push @o, $p }
  }
  return join '/', @o;
}

my ($nref, $absolute, $broken) = (0, 0, 0);
for my $f (@files) {
  my $t = slurp($f);
  next unless defined $t;
  (my $rel = $f) =~ s{^\Q$root\E/}{};
  (my $dir = $rel) =~ s{/[^/]+$}{};
  my $ln = 0;
  for my $line (split /\n/, $t) {
    $ln++;
    # A commented-out line is not a reference: store.js keeps the Supabase
    # swap as one, naming a file that deliberately does not exist yet.
    next if $line =~ m{^\s*(?://|/\*|\*)};

    # (\x60 is a backtick: template literals quote URLs too)
    if ($line =~ m{(?:\b(?:src|href)=["']|\burl\(\s*["']?|\bfetch\(\s*["'\x60]|\bfrom\s+["']|\bimport\(\s*["'])/(?!/)}) {
      $absolute++;
      fail("$rel:$ln a root-relative URL -- fine on serve.pl, a 404 under the Pages subpath");
    }

    my @refs;
    push @refs, [$1, "$dir/$1"] while $line =~ /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g;
    push @refs, [$1, "$dir/$1"] while $line =~ /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]/g;
    if ($rel =~ /\.html$/) {
      push @refs, [$1, "$dir/$1"] while $line =~ /\b(?:src|href)=["']([^"':#?]+\.[a-z0-9]+)["']/gi;
    }
    if ($rel =~ /\.css$/) {
      push @refs, [$1, "$dir/$1"] while $line =~ /\burl\(\s*['"]?([^'")#?:]+\.[a-z0-9]+)['"]?\s*\)/gi;
    }
    # Data files are fetched relative to the PAGE, which is app/index.html.
    push @refs, [$1, "app/$1"] while $line =~ /['"\x60](?:\.\/)?(data\/[A-Za-z0-9_\-\/]+\.json)['"\x60]/g;

    for my $r (@refs) {
      $nref++;
      my $p = norm($r->[1]);
      next if exact($p);
      $broken++;
      if (-e "$root/$p") {
        fail("$rel:$ln '$r->[0]' differs in case from the file on disk -- "
           . 'Windows forgives it, GitHub Pages 404s it');
      } else {
        fail("$rel:$ln '$r->[0]' does not exist");
      }
    }
  }
}
# Data files name images too, and the browser fetches those paths the same
# way -- so they get the same exact-case test.
my $nimg = 0;
if (opendir my $dd, "$APP/data") {
  for my $jf (sort grep { /\.json$/ } readdir $dd) {
    my $t = slurp("$APP/data/$jf");
    next unless defined $t;
    while ($t =~ m{"(img/[^"]+\.(?:jpe?g|png|webp|avif|svg))"}g) {
      my ($as, $p) = ($1, norm("app/$1"));
      $nimg++;
      next if exact($p);
      $broken++;
      fail(-e "$root/$p"
        ? "app/data/$jf: '$as' differs in case from the file on disk -- Windows forgives it, GitHub Pages 404s it"
        : "app/data/$jf: '$as' does not exist");
    }
  }
  closedir $dd;
}
ok('no root-relative URL in ' . scalar(@files) . ' files under app/') unless $absolute;
ok("all $nref references in code and $nimg image paths in data resolve, with exact case") unless $broken;

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "deploy.pl: all good\n";
exit 0;
