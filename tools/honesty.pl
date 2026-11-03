#!/usr/bin/perl
# The promise this site makes, enforced structurally.
#
#   perl tools/honesty.pl
#
# ---------------------------------------------------------------------------
# DEVI Collections does not take money and cannot send an order anywhere. Every
# screen says so. That is easy to write once and very easy to erode -- one
# well-meant "Thank you for your purchase!" and the site is lying to a real
# customer about a real payment.
#
# So the promise is not a convention here. It is a check.
# ---------------------------------------------------------------------------
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]honesty\.pl$}{};
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

# Every JavaScript file in the app.
my @FILES;
for my $dir ('', '/pages') {
  my $d = "$APP$dir";
  opendir my $dh, $d or next;
  push @FILES, map { "$dir/$_" } sort grep { /\.js$/ } readdir $dh;
  closedir $dh;
}
push @FILES, '/index.html';

# A file's source with comments stripped. The honesty rules are DISCUSSED at
# length in the comments of this project -- gateway-razorpay.js explains
# exactly why a payment id cannot be trusted -- so a checker that reads
# comments would fail on its own documentation.
sub code_of {
  my ($rel) = @_;
  my $src = slurp("$APP$rel");
  $src =~ s{/\*.*?\*/}{}gs;
  $src =~ s{^\s*//.*$}{}gm;
  $src =~ s{<!--.*?-->}{}gs;
  return $src;
}

my %CODE = map { $_ => code_of($_) } @FILES;

# ---------------------------------------------------------------------------
# 1. The four phrases that must never reach a customer.
#
# Not a style preference. Each one asserts something this site cannot know:
# that money moved, or that a merchant received an order.
# ---------------------------------------------------------------------------
my @BANNED = (
  [ qr/payment\s+(?:was\s+)?(?:successful|received|confirmed|complete)/i,
    'claims a payment this site cannot observe' ],
  [ qr/order\s+(?:confirmed|placed\s+successfully|successfully\s+placed)/i,
    'claims a confirmation only a human at DEVI can give' ],
  [ qr/thank\s+you\s+for\s+your\s+(?:purchase|order|payment)/i,
    'thanks the customer for something that has not happened yet' ],
  [ qr/we(?:'ve|\s+have)\s+received\s+your\s+order/i,
    'claims receipt -- nothing has been sent anywhere' ],
);

my $banned_hits = 0;
for my $rel (@FILES) {
  my @lines = split /\n/, $CODE{$rel};
  for my $i (0 .. $#lines) {
    for my $b (@BANNED) {
      next unless $lines[$i] =~ $b->[0];
      $banned_hits++;
      fail("app$rel:" . ($i + 1) . " $b->[1]\n      " . ($lines[$i] =~ s/^\s+//r));
    }
  }
}
ok('none of the four forbidden claims appears in any user-facing string')
  unless $banned_hits;

# ---------------------------------------------------------------------------
# 2. `paid` has exactly one writer, and it is the admin.
#
# orders.setPaid() exists for a human who has checked the bank. Anywhere else
# -- a checkout flow, a gateway callback -- it is the app deciding for itself
# that it has been paid, which it cannot know.
# ---------------------------------------------------------------------------
my @setpaid;
for my $rel (@FILES) {
  my @lines = split /\n/, $CODE{$rel};
  for my $i (0 .. $#lines) {
    next unless $lines[$i] =~ /setPaid\s*\(/;
    # The definition itself lives in backend-local.js.
    next if $rel eq '/backend-local.js';
    next if $rel eq '/pages/admin.js';
    push @setpaid, "app$rel:" . ($i + 1);
  }
}
if (@setpaid) {
  fail("setPaid() is called outside the admin at: " . join(', ', @setpaid));
} else {
  ok('setPaid() is reachable only from the admin');
}

# ---------------------------------------------------------------------------
# 3. A gateway response must never set `paid`.
#
# Razorpay's success handler returns razorpay_payment_id IN THE BROWSER, which
# is forgeable. recordGatewayClaim() writes verified:false and leaves paid
# alone; anything that joins the two is the bug this whole design exists to
# prevent.
# ---------------------------------------------------------------------------
my $bl = $CODE{'/backend-local.js'} // '';
my ($claim) = $bl =~ /async\s+recordGatewayClaim\s*\([^)]*\)\s*\{(.*?)\n  \}/s;
if (!$claim) {
  fail('recordGatewayClaim() not found in backend-local.js');
} elsif ($claim =~ /\.paid\s*=/) {
  fail('recordGatewayClaim() writes to .paid -- a browser-reported payment id '
     . 'is forgeable and must never mark an order paid');
} elsif ($claim !~ /verified:\s*false/) {
  fail('recordGatewayClaim() does not record verified:false');
} else {
  ok('a gateway claim records verified:false and never touches paid');
}

# ---------------------------------------------------------------------------
# 4. An order is born 'draft'.
#
# An order the merchant has never seen is not placed. place() must not be able
# to mint one in any other state.
# ---------------------------------------------------------------------------
my ($place) = $bl =~ /async\s+place\s*\([^)]*\)\s*\{(.*?)\n  \},/s;
if (!$place) {
  fail('place() not found in backend-local.js');
} else {
  if ($place =~ /status:\s*'([a-z]+)'/) {
    my $s = $1;
    if ($s eq 'draft') { ok("place() creates an order with status '$s'"); }
    else { fail("place() creates an order with status '$s', not 'draft'"); }
  } else {
    fail('place() does not set an explicit status');
  }
  fail('place() sets paid to true') if $place =~ /paid:\s*true/;
  fail('place() sets sent to true') if $place =~ /sent:\s*true/;
}

# ---------------------------------------------------------------------------
# 5. There is no login, anywhere.
#
# A login form that accepts any password is the most dishonest thing this site
# could ship, and the easiest to build by accident while scaffolding. This
# fails on a ROUTE, a screen name or a section id -- the three places one would
# appear -- and deliberately not on the word "login" in prose.
# ---------------------------------------------------------------------------
my $dom = slurp("$APP/domain.js");
my $html = slurp("$APP/index.html");
my @auth = qw(login signin sign-in signup sign-up register otp);
my $auth_hits = 0;

# Pull the ROUTES array out and look for the word anywhere inside it. A
# pattern that tries to match the regex literal itself is fragile about
# backslashes; the block is small and the word has no business in it at all.
my ($routes_block) = $dom =~ /export const ROUTES = \[(.*?)\n\];/s;
$routes_block = '' unless defined $routes_block;

for my $w (@auth) {
  if ($routes_block =~ /\b\Q$w\E\b/i || $dom =~ m{screen:\s*'$w'}i) {
    $auth_hits++; fail("domain.js ROUTES contains an auth route: $w");
  }
  if ($html =~ /data-screen="$w"/i) {
    $auth_hits++; fail("index.html contains an auth section: $w");
  }
  for my $rel (@FILES) {
    next unless $CODE{$rel} =~ /registerScreen\s*\(\s*'$w'/i;
    $auth_hits++; fail("app$rel registers an auth screen: $w");
  }
}
ok('no login, sign-up or OTP route, screen or section exists') unless $auth_hits;

# ---------------------------------------------------------------------------
# 6. No <form> pretends to submit.
#
# There is nothing to POST to. A form with an action, or a bare submit button
# inside a form with no preventDefault, is the shape a fake submission takes.
# ---------------------------------------------------------------------------
my $form_hits = 0;
for my $rel (@FILES) {
  my @lines = split /\n/, $CODE{$rel};
  for my $i (0 .. $#lines) {
    next unless $lines[$i] =~ /<form[^>]*\b(action|method)\s*=/i;
    $form_hits++;
    fail("app$rel:" . ($i + 1) . " a <form> declares action or method -- "
       . 'there is no server to submit to');
  }
}
ok('no form declares an action or a method') unless $form_hits;

# ---------------------------------------------------------------------------
# 7. The three load-bearing notices still exist AND are still referenced.
#
# An honesty string that nobody renders is worse than none: it reads as
# covered in review and shows nothing to a customer.
# ---------------------------------------------------------------------------
my %NOTICE = (
  'the no-server notice on the confirmation screen'
    => [ '/pages/confirm.js', qr/has not received this yet/ ],
  'the not-an-account notice'
    => [ '/pages/account.js', qr/This is not an account/ ],
  'the gateway-not-configured reason'
    => [ '/domain.js',        qr/Not set up yet/ ],
  'the this-browser-only notice on the admin orders board'
    => [ '/pages/admin.js',   qr/orders placed in THIS browser only/i ],
  'the demo-UPI strip'
    => [ '/pay.js',           qr/cannot take money/i ],
);
my $missing = 0;
for my $what (sort keys %NOTICE) {
  my ($rel, $re) = @{ $NOTICE{$what} };
  unless (($CODE{$rel} // '') =~ $re) {
    $missing++; fail("$what has gone from app$rel");
  }
}
ok(scalar(keys %NOTICE) . ' load-bearing notices are present') unless $missing;

# ---------------------------------------------------------------------------
# 8. The Razorpay seam still refuses.
# ---------------------------------------------------------------------------
my $gw = $CODE{'/gateway-razorpay.js'} // '';
if ($gw !~ /GATEWAY_NOT_CONFIGURED/) {
  fail('gateway-razorpay.js no longer refuses an unconfigured gateway');
} elsif ($gw =~ /\bpaid\b\s*=\s*true/) {
  fail('gateway-razorpay.js marks an order paid');
} else {
  ok('the Razorpay seam still refuses without credentials and a server');
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all honesty checks passed\n";
exit 0;
