#!/usr/bin/perl
# The promise this site makes, enforced structurally.
#
#   perl tools/honesty.pl
#
# ---------------------------------------------------------------------------
# This shop does not take money and cannot send an order anywhere. Every
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
push @FILES, '/index.html', '/owner.html';

# A file's source with comments stripped. The honesty rules are DISCUSSED at
# length in the comments of this project -- gateway-razorpay.js explains
# exactly why a payment id cannot be trusted -- so a checker that reads
# comments would fail on its own documentation.
sub code_of {
  my ($rel) = @_;
  my $src = slurp("$APP$rel");
  # Each comment is replaced by the newlines it held, and a // line keeps its
  # own, so a line number in a FAIL still points at the line it names. (`\s*`
  # at the start of a // match used to swallow the blank lines above it.)
  $src =~ s{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse;
  $src =~ s{^[ \t]*//[^\n]*}{}gm;
  $src =~ s{<!--.*?-->}{"\n" x (() = $& =~ /\n/g)}gse;
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
    'claims a confirmation only a human at the shop can give' ],
  [ qr/thank\s+you\s+for\s+your\s+(?:purchase|order|payment)/i,
    'thanks the customer for something that has not happened yet' ],
  [ qr/we(?:'ve|\s+have)\s+received\s+your\s+order/i,
    'claims receipt -- nothing has been sent anywhere' ],
);

my $banned_hits = 0;
for my $rel (@FILES) {
  # The STORE's files are not read by customers, and on them "Mark payment
  # received" is the owner's own button for what they checked in the bank --
  # the one human assertion of payment this project has (rule 2 keeps setPaid
  # to that screen). Skipped since 7 November 2026, when the owner asked for
  # that wording; every page a customer can open is still held to all four.
  next if $rel =~ m{^/(?:owner\.(?:js|html)|pages/admin(?:-catalog)?\.js)$};
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
    # The server backend defines it too -- as a call to set_paid(), which the
    # database refuses to anybody who is not staff. Exempt by name.
    next if $rel eq '/backend-supabase.js';
    next if $rel eq '/pages/admin.js';
    push @setpaid, "app$rel:" . ($i + 1);
  }
}
if (@setpaid) {
  fail("setPaid() is called outside the admin at: " . join(', ', @setpaid));
} else {
  ok('setPaid() is reachable only from the store page orders board');
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
  fail('place() does not start the order with deliveredAt: null')
    unless $place =~ /deliveredAt:\s*null/;
  fail('place() does not start the order with arrives: null -- a draft has '
     . 'reached nobody, so it has been promised nothing') unless $place =~ /arrives:\s*null/;
  # The code a customer quotes on WhatsApp carries the shop's own initials.
  if ($place =~ /['"`][A-Z]{1,4}-['"`]/) {
    fail('place() mints the order code from a literal prefix -- use D.orderCode(SHOP, seq)');
  } elsif ($place !~ /D\.orderCode\(/) {
    fail('place() does not mint its code with D.orderCode()');
  } else {
    ok("place() takes the order code's prefix from the shop's own name");
  }
  fail('place() sets sent to true') if $place =~ /sent:\s*true/;
}

# ---------------------------------------------------------------------------
# 4b. deliveredAt is written in ONE place: the line in advance() that runs as
# an order becomes delivered. The seven-day return window counts from it, so
# a second writer -- a page stamping it on display, a timer -- would move the
# day a customer can no longer send something back.
# ---------------------------------------------------------------------------
my @dwrite;
for my $rel (@FILES) {
  my @lines = split /\n/, $CODE{$rel};
  for my $i (0 .. $#lines) {
    push @dwrite, "app$rel:" . ($i + 1) if $lines[$i] =~ /\.deliveredAt\s*=(?!=)/;
  }
}
my ($adv) = $bl =~ /\nfunction advance\s*\([^)]*\)\s*\{(.*?)\n\}/s;
if (@dwrite != 1) {
  fail('deliveredAt is written in ' . scalar(@dwrite) . ' places, not one: ' . join(', ', @dwrite));
} elsif (!$adv || $adv !~ /if\s*\(\s*to\s*===\s*'delivered'\s*\)\s*o\.deliveredAt\s*=\s*at\s*;/) {
  fail("deliveredAt is not stamped by advance() as the order becomes delivered ($dwrite[0])");
} else {
  ok('deliveredAt is stamped in one place, as an order becomes delivered');
}

# ---------------------------------------------------------------------------
# 4c. An order's delivery promise is worked out ONCE, as the order reaches the
# shop, and only read after that.
#
# deliveryEstimate() answers "if I ordered today". That belongs on the product
# page and the shipping page, where the answer SHOULD move as today moves.
# Anywhere else it is an order screen re-deriving a promise already made --
# and the day the owner edits deliveryDays, every open order would quietly
# move with it. arrivalPromise() makes the promise, and only the backend may.
# ---------------------------------------------------------------------------
my %MAY_ESTIMATE = map { $_ => 1 } ('/domain.js', '/pages/product.js', '/pages/info.js');
# The server backend makes the promise in place(), because on a database that
# IS the moment the order reaches the shop; the database freezes it there.
my %MAY_PROMISE  = map { $_ => 1 } ('/domain.js', '/backend-local.js', '/backend-supabase.js');
my (@estimate, @promise, @awrite);
for my $rel (@FILES) {
  my @lines = split /\n/, $CODE{$rel};
  for my $i (0 .. $#lines) {
    my $here = "app$rel:" . ($i + 1);
    push @estimate, $here if $lines[$i] =~ /\bdeliveryEstimate\s*\(/ && !$MAY_ESTIMATE{$rel};
    push @promise,  $here if $lines[$i] =~ /\barrivalPromise\s*\(/  && !$MAY_PROMISE{$rel};
    push @awrite,   $here if $lines[$i] =~ /\.arrives\s*=(?!=)/;
  }
}
my $promise_bad = 0;
if (@estimate) {
  $promise_bad++;
  fail('deliveryEstimate() is called where an order is shown -- read order.arrives instead: '
     . join(', ', @estimate));
}
if (@promise) {
  $promise_bad++;
  fail('arrivalPromise() is called outside the backend: ' . join(', ', @promise));
}
if (@awrite != 1) {
  $promise_bad++;
  fail('order.arrives is written in ' . scalar(@awrite) . ' places, not one: ' . join(', ', @awrite));
} elsif (!$adv || $adv !~ /if\s*\(\s*to\s*===\s*'sent'\s*&&\s*!o\.arrives\s*\)\s*o\.arrives\s*=\s*D\.arrivalPromise\(/) {
  $promise_bad++;
  fail("order.arrives is not frozen once, by advance(), as the order is sent ($awrite[0])");
}
ok('the delivery promise is made once, as an order is sent, and only read after that')
  unless $promise_bad;

# ---------------------------------------------------------------------------
# 5. Signing in is OFFERED, NEVER REQUIRED, and never a password.
#
# Until step 7 this rule was "there is no login, anywhere": a login form that
# accepts any password is the most dishonest thing this site could ship, and
# the easiest to build by accident while scaffolding. Step 7 relaxed it
# DELIBERATELY, on 7 November 2026 -- a customer may sign in with an email and
# a six-digit code that Supabase checks on the server -- and this is what is
# left of it, four ways:
#
#   a. Sign-in is never a screen of its own. It is a box inside the account
#      page, checkout and an order's page; a ROUTE, a screen name or a section
#      id called login, signin, signup, register or otp is the shape a wall in
#      front of the shop would take. (Deliberately not the word in prose.)
#   b. No password field anywhere in the shop. The store page's code form is
#      the one password input in the project, and it is not the shop's.
#   c. Only backend-supabase.js talks to Supabase's sign-in, and never with a
#      password: no signInWithPassword, no signUp.
#   d. Buying never waits on an account: orders.place() makes its own guest
#      session first, so an order goes through for somebody never signed in.
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
# The store page's table as well: it is the likelier home for a login.
my ($owner_block) = $dom =~ /export const OWNER_ROUTES = \[(.*?)\n\];/s;
$routes_block .= $owner_block // '';
my $ohtml = slurp("$APP/owner.html");

for my $w (@auth) {
  if ($routes_block =~ /\b\Q$w\E\b/i || $dom =~ m{screen:\s*'$w'}i) {
    $auth_hits++; fail("domain.js ROUTES contains an auth route: $w");
  }
  if ($html =~ /data-screen="$w"/i) {
    $auth_hits++; fail("index.html contains an auth section: $w");
  }
  if ($ohtml =~ /data-screen="$w"/i) {
    $auth_hits++; fail("owner.html contains an auth section: $w");
  }
  for my $rel (@FILES) {
    next unless $CODE{$rel} =~ /registerScreen\s*\(\s*'$w'/i;
    $auth_hits++; fail("app$rel registers an auth screen: $w");
  }
}
ok('sign-in is never a screen of its own: no login, sign-up or OTP route, screen or section')
  unless $auth_hits;

# b. No password field in the shop. The store's own files are the exception.
my %STORE_SIDE = map { $_ => 1 } ('/owner.js', '/owner.html', '/pages/admin.js',
                                  '/pages/admin-catalog.js');
my @pw;
for my $rel (@FILES) {
  next if $STORE_SIDE{$rel};
  push @pw, "app$rel" if $CODE{$rel} =~ /type\s*[=:]\s*["']password["']/i;
}
if (@pw) { fail('a password field in the shop: ' . join(', ', @pw)
              . ' -- signing in is an email and a code, never a password'); }
else { ok('no password field anywhere in the shop'); }

# c. One module talks to Supabase's sign-in, and never with a password.
my (@auth_calls, @pw_calls);
for my $rel (@FILES) {
  push @pw_calls, "app$rel" if $CODE{$rel} =~ /\b(?:signInWithPassword|signUp)\s*\(/;
  next if $rel eq '/backend-supabase.js';
  push @auth_calls, "app$rel"
    if $CODE{$rel} =~ /\.(?:signInWithOtp|verifyOtp|updateUser|signInAnonymously)\s*\(/;
}
if (@pw_calls) { fail('a password sign-in or sign-up: ' . join(', ', @pw_calls)); }
if (@auth_calls) { fail('Supabase sign-in called outside backend-supabase.js: '
                      . join(', ', @auth_calls)); }
ok('only backend-supabase.js signs anyone in, and never with a password')
  unless @pw_calls || @auth_calls;

# d. An order goes through for somebody never signed in.
my ($place) = ($CODE{'/backend-supabase.js'} // '') =~ /async\s+place\s*\(\s*draft\s*\)\s*\{(.*?)\n  \},/s;
if (!defined $place) {
  fail('could not find orders.place() in backend-supabase.js');
} elsif ($place !~ /^\s*await\s+begin\(\)\s*;/) {
  fail('orders.place() no longer starts by making its own guest session -- '
     . 'buying must never wait on an account');
} else {
  ok('placing an order makes its own guest session: buying never waits on an account');
}

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
  # 'the gateway-not-configured reason' -- "Not set up yet" on greyed-out card
  # and net banking options -- was here until 7 November 2026. The options are
  # gone, on the owner's word: the shop takes UPI and cash on delivery, and a
  # card needs a gateway and a server it does not have. Nothing claims a card
  # can be used, so there is no reason left to show. The Razorpay seam's own
  # check, further down, still holds.
  'the this-browser-only notice on the store orders board'
    => [ '/pages/admin.js',   qr/orders placed in THIS browser only/i ],
  # 'the demo-UPI strip' -- "This QR cannot take money" -- was here until
  # 7 November 2026. Taken out DELIBERATELY, on the owner's word: the site is
  # shown to people as the flow it will be. The guard moved into the data:
  # data.pl fails unless a demo id sits on @example, which resolves to nobody,
  # and fails if placeholder goes false while the id is a demo. The preview
  # bar below still calls every order placed here a test.
  'the preview bar, while shop.json says placeholder'
    => [ '/ui.js',            qr/an order placed here is a test, not a purchase/ ],
  'the not-locked-yet bar on the store page, until a server checks the code'
    => [ '/owner.js',         qr/Not locked yet/ ],
  'the element the store page states its lock in'
    => [ '/owner.html',       qr/id="owner-bar"/ ],
  'the element the preview bar is drawn into'
    => [ '/index.html',       qr/id="preview-bar"/ ],
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
