#!/usr/bin/perl
# CSS token parity and the no-literal-colour rule.
#
#   perl tools/tokens.pl
#
# Adapted from kirana's, which reads the <style> block of one index.html.
# DEVI splits its CSS across app/styles/*.css, so this reads them all -- and
# enforces that ALL THREE :root blocks live in tokens.css and nowhere else.
#
# Two halves, both of which matter:
#   1. Every palette block declares the SAME token set. A token defined in one
#      block and missing from another is how a theme ends up black on black.
#   2. No component rule names a colour. A hex outside tokens.css is a colour
#      that can never follow the theme.
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]tokens\.pl$}{};
$root = '.' if $root eq $0;
my $CSS = "$root/app/styles";

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

sub slurp {
  my ($p) = @_;
  open my $fh, '<:encoding(UTF-8)', $p or die "cannot read $p: $!\n";
  local $/; my $t = <$fh>; close $fh;
  return $t;
}

opendir my $dh, $CSS or die "cannot open $CSS: $!\n";
my @files = sort grep { /\.css$/ } readdir $dh;
closedir $dh;
die "no stylesheets in $CSS\n" unless @files;

# ---------------------------------------------------------------------------
# 1. All three :root blocks live in tokens.css and nowhere else.
# ---------------------------------------------------------------------------
for my $f (@files) {
  next if $f eq 'tokens.css';
  my $src = slurp("$CSS/$f");
  # Strip comments first -- a :root mentioned in prose is not a declaration.
  $src =~ s{/\*.*?\*/}{}gs;
  # A :root outside tokens.css is allowed ONLY for non-colour tokens: the
  # responsive overrides of --rail and --gutter are a layout concern and
  # belong with the layout. What must never leave tokens.css is a COLOUR,
  # because that is the thing a theme has to be able to change in one place.
  while ($src =~ /:root\s*\{/g) {
    my $body = block_at($src, $-[0]) // '';
    while ($body =~ /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi) {
      my ($k, $v) = ($1, $2);
      fail("$f overrides the colour token $k outside tokens.css")
        if $v =~ /\#[0-9A-Fa-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
    }
  }
}

my $tok = slurp("$CSS/tokens.css");
$tok =~ s{/\*.*?\*/}{}gs;

# Pull the three blocks out by brace matching, because a nested @media means a
# naive /\{(.*?)\}/ stops at the first inner close.
sub block_at {
  my ($src, $pos) = @_;
  my $open = index($src, '{', $pos);
  return undef if $open < 0;
  my ($depth, $i) = (0, $open);
  while ($i < length $src) {
    my $ch = substr($src, $i, 1);
    $depth++ if $ch eq '{';
    if ($ch eq '}') { $depth--; return substr($src, $open + 1, $i - $open - 1) if !$depth; }
    $i++;
  }
  return undef;
}

my @blocks;
push @blocks, ['light',  block_at($tok, $-[0]) ] while $tok =~ /^:root\s*\{/gm;
push @blocks, ['media',  block_at($tok, $-[0]) ] while $tok =~ /:root:not\(\[data-theme="light"\]\)\s*\{/g;
push @blocks, ['forced', block_at($tok, $-[0]) ] while $tok =~ /:root\[data-theme="dark"\]\s*\{/g;

fail('expected exactly 3 palette blocks, found ' . scalar @blocks)
  unless @blocks == 3;

# ---------------------------------------------------------------------------
# 2. Identical token sets.
# ---------------------------------------------------------------------------
my (%set, %val);
for my $b (@blocks) {
  my ($name, $body) = @$b;
  next unless defined $body;
  while ($body =~ /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi) {
    my ($k, $v) = ($1, $2);
    $v =~ s/^\s+|\s+$//g;
    $set{$name}{$k} = 1;
    $val{$name}{$k} = $v;
  }
}

my @names = map { $_->[0] } @blocks;
if (@names == 3) {
  my %all;
  $all{$_} = 1 for map { keys %{ $set{$_} } } @names;
  for my $k (sort keys %all) {
    my @missing = grep { !$set{$_}{$k} } @names;
    fail("token $k is missing from: " . join(', ', @missing)) if @missing;
  }
  ok(scalar(keys %all) . ' tokens, declared in all three blocks')
    unless grep { my $k = $_; grep { !$set{$_}{$k} } @names } keys %all;

  # The two dark blocks must be byte-identical: they exist to say the same
  # thing twice, and a difference between them is always an accident.
  my @diff = grep { ($val{media}{$_} // '') ne ($val{forced}{$_} // '') }
             sort keys %all;
  if (@diff) {
    fail('the two dark blocks disagree on: ' . join(', ', @diff));
  } else {
    ok('the two dark blocks are identical');
  }

  # DEVI ships light-only. That is honest ONLY if color-scheme says light in
  # every block -- otherwise the page renders ivory while the browser renders
  # scrollbars and date pickers dark on top of it.
  my %scheme;
  for my $b (@blocks) {
    my ($n, $body) = @$b;
    if (($body // '') =~ /color-scheme\s*:\s*(light|dark)/) { $scheme{$n} = $1; }
    else { fail("the $n block does not set color-scheme"); }
  }
  my @vals = map { $scheme{$_} // '?' } @names;
  my %u; $u{$_} = 1 for @vals;
  if (keys %u == 1 && $vals[0] eq 'light') {
    ok('color-scheme is light in all three blocks -- light-only, declared honestly');
  } elsif (keys %u == 1) {
    ok("color-scheme is $vals[0] in all three blocks");
  } else {
    fail('color-scheme differs between blocks (' . join(', ', @vals) . ') -- '
       . 'a page whose palette and native widgets disagree is half-themed');
  }
}

# ---------------------------------------------------------------------------
# 3. No literal colour outside tokens.css.
# ---------------------------------------------------------------------------
my $lits = 0;
for my $f (@files) {
  next if $f eq 'tokens.css';
  my $src = slurp("$CSS/$f");
  my @lines = split /\n/, $src;
  my $incomment = 0;
  for my $i (0 .. $#lines) {
    my $l = $lines[$i];
    # Track block comments so a hex quoted in prose is not a finding.
    my $stripped = $l;
    if ($incomment) {
      if ($stripped =~ s{^.*?\*/}{}) { $incomment = 0; } else { next; }
    }
    $stripped =~ s{/\*.*?\*/}{}g;
    if ($stripped =~ s{/\*.*$}{}) { $incomment = 1; }

    # ⚠️ The # MUST be escaped. Under /x an unescaped # starts a comment, which
    # silently truncates the pattern to an empty alternative -- and an empty
    # alternative matches every line in the file. That is exactly what this
    # check did on its first run: 400 findings, every one of them a blank line.
    next unless $stripped =~ /\#[0-9A-Fa-f]{3,8}\b
                            | \brgba?\s*\(
                            | \bhsla?\s*\(
                            | : \s* (?:white|black|red|blue|green|grey|gray|silver|gold) \s* ;/x;
    # currentColor and transparent are not literals.
    next if $stripped =~ /currentColor|transparent/ && $stripped !~ /\#[0-9A-Fa-f]{3,8}\b/;
    $lits++;
    fail("$f:" . ($i + 1) . " names a literal colour: " . ($stripped =~ s/^\s+//r));
  }
}
ok('no literal colours in ' . (scalar(@files) - 1) . ' component stylesheets')
  unless $lits;

# ---------------------------------------------------------------------------
# 4. Every var(--x) used anywhere resolves to a declared token.
# ---------------------------------------------------------------------------
my %declared = %{ $set{light} || {} };
my %used;
for my $f (@files) {
  my $src = slurp("$CSS/$f");
  $src =~ s{/\*.*?\*/}{}gs;
  while ($src =~ /var\(\s*(--[a-z0-9-]+)/gi) { $used{$1} ||= $f; }
}
my @unres = grep { !$declared{$_} } sort keys %used;
if (@unres) {
  fail("var($_) in $used{$_} is not declared in tokens.css") for @unres;
} else {
  ok(scalar(keys %used) . ' var() references all resolve');
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all token checks passed\n";
exit 0;
