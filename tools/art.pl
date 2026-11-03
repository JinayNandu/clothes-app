#!/usr/bin/perl
# Literal colours and unresolvable tokens in the modules that EMIT MARKUP.
#
#   perl tools/art.pl
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS SEPARATELY FROM tokens.pl
#
# tokens.pl reads app/styles/*.css and nothing else. But app/art.js and
# app/brand.js write SVG, and between them they hold more colour references
# than any stylesheet in the project. The checker cannot see any of it -- so
# someone could hardcode #C8A96E into a motif, every check would pass, and the
# artwork would silently stop following the theme.
#
# This closes that hole. It is the same two rules tokens.pl applies, pointed at
# the JavaScript instead.
# ---------------------------------------------------------------------------
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]art\.pl$}{};
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

# Every module that emits markup. Page modules are included because a page that
# writes an inline style with a hex is the same bug wearing a different hat.
my @SCAN = ('art.js', 'brand.js', 'icons.js', 'components.js', 'ui.js', 'sidebar.js');
opendir my $dh, "$APP/pages";
push @SCAN, map { "pages/$_" } sort grep { /\.js$/ } readdir $dh if $dh;
closedir $dh if $dh;

# Declared tokens, read from the light palette.
my $tok = slurp("$APP/styles/tokens.css");
$tok =~ s{/\*.*?\*/}{}gs;
my %declared;
$declared{$1} = 1 while $tok =~ /(--[a-z0-9-]+)\s*:/g;

my ($scanned, $lits, %used) = (0, 0);

for my $f (@SCAN) {
  my $path = "$APP/$f";
  next unless -f $path;
  $scanned++;
  my $src = slurp($path);
  my @lines = split /\n/, $src;

  my $incomment = 0;
  for my $i (0 .. $#lines) {
    my $l = $lines[$i];

    # Strip comments. A hex discussed in a header comment -- and this project's
    # headers discuss several, with their measured contrast ratios -- is
    # documentation, not a declaration.
    if ($incomment) {
      if ($l =~ s{^.*?\*/}{}) { $incomment = 0; } else { next; }
    }
    $l =~ s{/\*.*?\*/}{}g;
    if ($l =~ s{/\*.*$}{}) { $incomment = 1; }
    $l =~ s{//.*$}{};

    # ⚠️ Escape the # -- under /x an unescaped one starts a comment and
    # truncates the pattern to an empty alternative, which matches every line.
    if ($l =~ /(\#[0-9A-Fa-f]{3,8})\b | (\brgba?\s*\() | (\bhsla?\s*\()/x) {
      # The ONE exception, and it is product data rather than theme: a colour
      # swatch in catalog.json is a real fabric colour and has no token. It is
      # read from the data and interpolated, never written here -- so a literal
      # in the SOURCE is still a finding.
      $lits++;
      my $t = $l; $t =~ s/^\s+|\s+$//g;
      fail("$f:" . ($i + 1) . " names a literal colour: $t");
    }

    $used{$1} ||= "$f:" . ($i + 1) while $l =~ /var\(\s*(--[a-z0-9-]+)/g;
  }
}

ok("$scanned markup modules scanned");
ok('no literal colours in any markup module') unless $lits;

my @unres = grep { !$declared{$_} } sort keys %used;
if (@unres) {
  fail("var($_) at $used{$_} is not declared in tokens.css") for @unres;
} else {
  ok(scalar(keys %used) . ' var() references in JavaScript all resolve');
}

# The artwork tokens must be NON-VARYING -- identical in all three palette
# blocks. A generated swatch is cloth under light; inverting it in dark mode
# makes every product read as a cut-out, and a real photograph (the swap path)
# is shot on white and cannot invert at all. tokens.pl proves the two dark
# blocks match each other; this proves they match the LIGHT one too, which is
# the half that would otherwise go unnoticed.
my @art = qw(--art-paper --art-ink --art-ink-2 --art-gold
             --p-blush --p-sage --p-sky --p-sand --p-lilac --p-clay);
my @vals;
for my $k (@art) {
  my @found;
  push @found, $1 while $tok =~ /\Q$k\E\s*:\s*([^;]+);/g;
  my %u; $u{ $_ =~ s/\s//gr } = 1 for @found;
  if (@found != 3) {
    fail("$k is declared " . scalar(@found) . " times, expected 3");
  } elsif (keys %u != 1) {
    fail("$k VARIES between palettes (" . join(' / ', @found) . ") -- "
       . 'artwork tokens must be identical in all three; see tokens.css');
  }
}
ok(scalar(@art) . ' artwork tokens are identical in all three palettes')
  unless $fails;

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all artwork checks passed\n";
exit 0;
