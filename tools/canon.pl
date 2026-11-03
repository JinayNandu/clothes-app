#!/usr/bin/perl
# The data files are already in the exact form the admin's export produces.
#
#   perl tools/canon.pl          check
#   perl tools/canon.pl --write  rewrite them into canonical form
#
# ---------------------------------------------------------------------------
# WHY THIS MATTERS MORE THAN IT LOOKS
#
# The admin (pass 2) edits the catalogue in the browser and exports it as JSON
# to drop back into app/data/. JSON.stringify emits keys in INSERTION order,
# so unless both sides agree on an ordering, the very first export produces a
# 2,700-line diff with no semantic content -- and after that the owner can
# never review a catalogue change again, because every change looks like every
# other change.
#
# So both sides commit to the same canonical form: keys sorted, two-space
# indent, one trailing newline. JSON::PP->canonical produces it on this side;
# a recursive key sort produces it on the JavaScript side.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;

my $root = $0; $root =~ s{[/\\]tools[/\\]canon\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";

my $write = grep { $_ eq '--write' } @ARGV;

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

my @DATA = qw(catalog.json categories.json shop.json pages.json);

# ⚠️ canonical() sorts keys; pretty() would give a 3-space indent, so indent
# width is set explicitly. These three settings ARE the contract.
my $J = JSON::PP->new->utf8(0)->canonical(1)->indent(1)->indent_length(2)->space_after(1);

for my $f (@DATA) {
  my $path = "$APP/data/$f";
  unless (-f $path) { fail("$f is missing"); next; }

  open my $fh, '<:encoding(UTF-8)', $path or do { fail("cannot read $f"); next; };
  local $/; my $raw = <$fh>; close $fh;

  my $data = eval { JSON::PP->new->utf8(0)->decode($raw) };
  unless ($data) { fail("$f is not valid JSON: $@"); next; }

  my $canon = $J->encode($data);
  $canon .= "\n" unless $canon =~ /\n$/;

  if ($raw eq $canon) {
    ok("$f is canonical");
    next;
  }

  if ($write) {
    open my $out, '>:encoding(UTF-8)', $path or do { fail("cannot write $f"); next; };
    print $out $canon; close $out;
    ok("$f rewritten into canonical form");
    next;
  }

  # Say WHERE, not just that. A bare "not canonical" on a 2,700-line file is
  # not an actionable message.
  my @a = split /\n/, $raw;
  my @b = split /\n/, $canon;
  my $at = 0;
  $at++ while $at < @a && $at < @b && $a[$at] eq $b[$at];
  fail("$f is not canonical -- first difference at line " . ($at + 1) . "\n"
     . '      is:     ' . (defined $a[$at] ? ($a[$at] =~ s/^\s+//r) : '(end of file)') . "\n"
     . '      should: ' . (defined $b[$at] ? ($b[$at] =~ s/^\s+//r) : '(end of file)') . "\n"
     . '      Run: perl tools/canon.pl --write');
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print $write ? "data files are canonical\n" : "all canonical-form checks passed\n";
exit 0;
