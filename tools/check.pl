#!/usr/bin/perl
# Runs every check. One command, one exit code.
#
#   perl tools/check.pl
#
# Each script below was proved by BREAKING the code and watching it fail, not
# by passing on a clean tree. A check that has only ever been green has not
# been tested; it has been assumed.
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]check\.pl$}{};
$root = '.' if $root eq $0;

my @CHECKS = (
  ['data.pl',    'catalogue, categories, shop config, and the honesty flags'],
  ['money.pl',   'basket arithmetic, and that domain.js still implements it'],
  ['tokens.pl',  'palette parity and no literal colour in a component rule'],
  ['art.pl',     'the same two rules, pointed at the modules that emit SVG'],
  ['canon.pl',   'the data files are already in the admin export form'],
  ['routes.pl',  'every hash link resolves and no module imports backwards'],
  ['honesty.pl', 'the promise this site makes, enforced structurally'],
  ['clock.pl',   'every date read lives in domain.js'],
  ['balance.pl', 'unbalanced brackets and strings'],
);

my ($ran, $failed) = (0, 0);
my @bad;

for my $c (@CHECKS) {
  my ($script, $what) = @$c;
  my $path = "$root/tools/$script";
  unless (-f $path) {
    printf "---- %-12s SKIPPED (not written yet)\n", $script;
    next;
  }
  $ran++;
  printf "==== %-12s %s\n", $script, $what;
  my $rc = system($^X, $path);
  print "\n";
  if ($rc != 0) { $failed++; push @bad, $script; }
}

print "=" x 68, "\n";
if ($failed) {
  printf "%d of %d checks FAILED: %s\n", $failed, $ran, join(', ', @bad);
  exit 1;
}
printf "all %d checks passed\n", $ran;
exit 0;
