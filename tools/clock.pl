#!/usr/bin/perl
# Every date and clock read lives in domain.js.
#
#   perl tools/clock.pl
#
# ---------------------------------------------------------------------------
# WHY: `new Date().toISOString().slice(0,10)` is UTC. On an IST device between
# 00:00 and 05:30 it returns YESTERDAY. Anything keyed on it is wrong for five
# and a half hours every night -- invisible in daylight, trivial to reproduce
# at 1 AM, and the symptom ("last night's orders have the wrong date") never
# points at the cause.
#
# ⚠️ THIS CLOSES THREE GAPS that kirana's slots.pl leaves open. That one greps
# only for `.slice(` directly after toISOString, so all three of these pass it
# while being exactly the same bug:
#
#     d.toISOString().substring(0, 10)
#     d.toISOString().split('T')[0]
#     const s = d.toISOString();  s.slice(0, 10);     <- across two lines
#
# A bare `toISOString()` is FINE and is used deliberately: a full instant is
# unambiguous. It is only turning one into a DATE that is wrong.
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]clock\.pl$}{};
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

# Comments are stripped everywhere before matching.
# ⚠️ Including from domain.js itself. That file DOCUMENTS why hour12:false is
# wrong, and the first version of this check read its own documentation and
# failed on it.
sub code_of {
  my ($p) = @_;
  my $s = slurp($p);
  $s =~ s{/\*.*?\*/}{}gs;
  $s =~ s{^\s*//.*$}{}gm;
  return $s;
}

my @FILES;
for my $dir ('', '/pages') {
  opendir my $dh, "$APP$dir" or next;
  push @FILES, map { "$dir/$_" } sort grep { /\.js$/ } readdir $dh;
  closedir $dh;
}

my @BAD = (
  [ qr/toISOString\s*\(\s*\)\s*\.\s*slice\s*\(/,     'toISOString().slice() -- that is a UTC date' ],
  [ qr/toISOString\s*\(\s*\)\s*\.\s*substring\s*\(/, 'toISOString().substring() -- same bug, different method' ],
  [ qr/toISOString\s*\(\s*\)\s*\.\s*split\s*\(/,     "toISOString().split('T') -- same bug again" ],
  [ qr/getTimezoneOffset\s*\(/,                      'getTimezoneOffset() -- the device zone is not IST' ],
  [ qr/toLocaleDateString\s*\(\s*\)/,                'toLocaleDateString() with no timeZone' ],
  [ qr/new\s+Date\s*\(\s*\)\s*\.\s*getFullYear/,     'getFullYear() on the device clock' ],
  [ qr/new\s+Date\s*\(\s*\)\s*\.\s*getDate\b/,       'getDate() on the device clock' ],
  [ qr/new\s+Date\s*\(\s*\)\s*\.\s*getMonth/,        'getMonth() on the device clock' ],
  [ qr/new\s+Date\s*\(\s*\)\s*\.\s*getHours/,        'getHours() on the device clock' ],
);

my ($scanned, $hits) = (0, 0);

for my $rel (@FILES) {
  next if $rel eq '/domain.js';     # the one place all of this belongs
  $scanned++;
  my @lines = split /\n/, code_of("$APP$rel");

  for my $i (0 .. $#lines) {
    for my $b (@BAD) {
      next unless $lines[$i] =~ $b->[0];
      $hits++;
      fail("app$rel:" . ($i + 1) . " $b->[1]");
    }
  }

  # The two-line form: a toISOString() captured into a variable, then sliced
  # a few lines later. This is the one that reads as innocent.
  for my $i (0 .. $#lines) {
    next unless $lines[$i] =~ /(?:const|let|var)\s+(\w+)\s*=\s*[^;]*toISOString\s*\(\s*\)/;
    my $v = $1;
    my $to = $i + 4 > $#lines ? $#lines : $i + 4;
    for my $j ($i + 1 .. $to) {
      next unless $lines[$j] =~ /\b\Q$v\E\s*\.\s*(?:slice|substring|split)\s*\(/;
      $hits++;
      fail("app$rel:" . ($j + 1) . " slices a toISOString() captured on line "
         . ($i + 1) . ' -- a UTC date, two lines apart');
    }
  }
}

ok("$scanned modules scanned, none reads a date outside domain.js") unless $hits;

# ---------------------------------------------------------------------------
# domain.js itself must use the right primitives.
# ---------------------------------------------------------------------------
my $dom = code_of("$APP/domain.js");

if ($dom =~ /hour12\s*:\s*false/) {
  fail("domain.js uses hour12:false -- several engines return \"24:00\" for\n"
     . '      midnight, so 00:05 computes as 1445 minutes. Use hourCycle h23.');
} elsif ($dom =~ /hourCycle:\s*'h23'/) {
  ok('domain.js uses hourCycle h23, not hour12:false');
} else {
  fail('domain.js sets neither hourCycle h23 nor hour12');
}

fail('domain.js does not pin Asia/Kolkata') unless $dom =~ /Asia\/Kolkata/;
if ($dom =~ /formatToParts/) {
  ok('domain.js reads IST through formatToParts, not a format string');
} else {
  fail('domain.js assembles a date from a format string rather than '
     . 'formatToParts, which a locale quirk can bend');
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all clock checks passed\n";
exit 0;
