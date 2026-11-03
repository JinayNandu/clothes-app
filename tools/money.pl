#!/usr/bin/perl
# Basket arithmetic: 500 random baskets plus five named boundary cases.
#
#   perl tools/money.pl
#
# ---------------------------------------------------------------------------
# WHY THIS SCRIPT HAS A SOURCE CHECK AS WELL AS A MATHS CHECK
#
# A Perl script cannot run domain.js, so on its own it tests the SPEC and not
# the implementation -- and the two can drift apart silently. That is not
# hypothetical: kirana's app/domain.js:146 computes its delivery fee from the
# POST-coupon total while its tools/money.pl:47 computes it from the PRE-coupon
# items total. The two have disagreed for as long as both have existed, and it
# is invisible there only because kirana ships fee:0 and freeOver:0, so both
# branches return zero.
#
# DEVI ships a real Rs 99 fee and a real Rs 1,999 threshold, so the same drift
# would be a live arithmetic error on day one. Case (a) below pins the rule,
# and check_source() pins the line of JavaScript that implements it.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;

my $root = $0; $root =~ s{[/\\]tools[/\\]money\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

sub load {
  my ($p) = @_;
  open my $fh, '<:encoding(UTF-8)', $p or die "cannot read $p: $!\n";
  local $/; my $t = <$fh>; close $fh;
  my $d = eval { JSON::PP->new->utf8(0)->decode($t) };
  die "$p is not valid JSON: $@" unless $d;
  return $d;
}

my $shop = load("$APP/data/shop.json");
my $cl   = load("$APP/data/catalog.json");
my @P    = @{ $cl->{products} };
my $R    = $shop->{shipping};
my %BY   = map { $_->{id} => $_ } @P;

printf "fee %d, freeOver %d (%s), bulky %d, %d products\n\n",
  $R->{fee}, $R->{freeOver}, $R->{freeOverBasis}, $R->{bulkySurcharge}, scalar @P;

# ---------------------------------------------------------------------------
# The spec, in Perl. Mirrors domain.js totals().
# ---------------------------------------------------------------------------
sub unit_price {
  my ($p, $size) = @_;
  my $d = 0;
  if ($size && $p->{variants} && $p->{variants}{size}) {
    for my $s (@{ $p->{variants}{size} }) { $d = $s->{delta} // 0 if $s->{id} eq $size; }
  }
  return $p->{price} + $d;
}
sub unit_mrp {
  my ($p, $size) = @_;
  my $d = 0;
  if ($size && $p->{variants} && $p->{variants}{size}) {
    for my $s (@{ $p->{variants}{size} }) { $d = $s->{delta} // 0 if $s->{id} eq $size; }
  }
  return $p->{mrp} + $d;
}

sub totals {
  my ($lines, $coupon) = @_;
  my ($items, $mrp, $bulky, $physical) = (0, 0, 0, 0);

  for my $ln (@$lines) {
    # ⚠️ die, NOT `next`. A named case aimed at a product that has
    # since been delisted would otherwise total zero and quietly pass --
    # which is exactly what case (f) did once the gift cards were removed.
    my $p = $BY{ $ln->{pid} }
      or die "money.pl: no product '$ln->{pid}' -- a named case is "
           . "pointing at something the catalogue no longer has\n";
    $items += unit_price($p, $ln->{size}) * $ln->{qty};
    $mrp   += unit_mrp($p,   $ln->{size}) * $ln->{qty};
    if (($p->{kind} // 'goods') ne 'voucher') {
      $physical += $ln->{qty};
      # Once per bulky LINE, not per unit.
      $bulky += $R->{bulkySurcharge} if ($p->{shipClass} // 'std') eq 'bulky';
    }
  }

  my ($discount, $couponOk) = (0, 0);
  if ($coupon && $items >= ($coupon->{minItems} // 0)) {
    $couponOk = 1;
    $discount = ($coupon->{percent} // 0)
      ? int($items * $coupon->{percent} / 100 + 0.5)   # rounded ONCE, on the total
      : ($coupon->{flat} // 0);
    $discount = $coupon->{maxOff} if $coupon->{maxOff} && $discount > $coupon->{maxOff};
    $discount = $items if $discount > $items;
  }

  # ⚠️ THE RULE: measured on $items, NOT on ($items - $discount).
  my $free = ($physical == 0 || $items >= $R->{freeOver});
  my $ship = $free ? 0 : $R->{fee};

  return {
    items => $items, mrp => $mrp, saved => ($mrp - $items),
    couponOk => $couponOk, discount => $discount,
    shipping => $ship, bulky => $bulky, physical => $physical,
    grand => $items - $discount + $ship + $bulky,
  };
}

# ---------------------------------------------------------------------------
# 500 random baskets
# ---------------------------------------------------------------------------
srand(20261101);
my @codes = grep { $_->{active} } @{ $shop->{coupons}{codes} };
my $bad = 0;

for my $n (1 .. 500) {
  my @lines;
  for (1 .. 1 + int(rand 6)) {
    my $p = $P[ int rand @P ];
    my $size;
    if ($p->{variants} && $p->{variants}{size} && @{ $p->{variants}{size} }) {
      $size = $p->{variants}{size}[ int rand @{ $p->{variants}{size} } ]{id};
    }
    push @lines, { pid => $p->{id}, qty => 1 + int(rand 3), size => $size };
  }
  my $coupon = (rand() < 0.5) ? $codes[ int rand @codes ] : undef;
  my $t = totals(\@lines, $coupon);

  for my $k (qw(items mrp discount shipping bulky grand)) {
    if ($t->{$k} != int $t->{$k}) { fail("basket $n: $k is not an integer"); $bad++; last; }
  }
  $bad++, fail("basket $n: grand does not reconcile")
    if $t->{grand} != $t->{items} - $t->{discount} + $t->{shipping} + $t->{bulky};
  $bad++, fail("basket $n: discount exceeds items") if $t->{discount} > $t->{items};
  $bad++, fail("basket $n: mrp is below items")     if $t->{mrp} < $t->{items};
  $bad++, fail("basket $n: grand is negative")      if $t->{grand} < 0;

  # The invariant that encodes the rule, checked on every random basket.
  if ($t->{physical} > 0) {
    $bad++, fail("basket $n: items $t->{items} >= freeOver but shipping charged")
      if $t->{items} >= $R->{freeOver} && $t->{shipping} != 0;
    $bad++, fail("basket $n: items $t->{items} < freeOver but shipping free")
      if $t->{items} < $R->{freeOver} && $t->{shipping} != $R->{fee};
  }
  last if $bad > 4;
}
ok('500 random baskets reconcile, all integers') unless $bad;

# ---------------------------------------------------------------------------
# THE NAMED CASES
# ---------------------------------------------------------------------------
print "\n";

# ---------------------------------------------------------------------------
# TWO SYNTHETIC PRODUCTS, for the rules the catalogue no longer exercises.
#
# ⚠️ Deliberate, not laziness. Since the shop narrowed to bed linen,
# nothing in the catalogue is `bulky` and nothing is a `voucher` -- but both
# rules are still live: the surcharge in shop.json, the voucher branch in
# domain.js, and the PDP copy saying a code is issued by hand. Aiming these
# cases at a REAL product is what went wrong before -- they pointed at a
# stool and a gift card, and when those were delisted the suite went on
# reporting green. A live rule with no catalogue example gets one here.
# ---------------------------------------------------------------------------
$BY{'t-bulky'}   = { id => 't-bulky',   price => 4000, mrp => 4000,
                     kind => 'goods',   shipClass => 'bulky' };
$BY{'t-voucher'} = { id => 't-voucher', price => 1000, mrp => 1000,
                     kind => 'voucher', shipClass => 'std'   };

# (a) THE ONE THAT MATTERS. A basket just over the threshold, with a percentage
#     coupon that drops the payable BELOW it. Free shipping must survive --
#     the customer had already earned it before the code was applied.
{
  my $devi10 = (grep { $_->{code} eq 'DEVI10' } @codes)[0];
  # The basket has to actually cross back under, or the case proves nothing.
  # p-bs-sanganeri-cotton is 2199: clears freeOver (1999) on items, and 10% off
  # takes the payable to 1979, which is below it. That straddle is the test.
  my $t = totals([{ pid => 'p-bs-sanganeri-cotton', qty => 1 }], $devi10);
  my $payable = $t->{items} - $t->{discount};
  if ($t->{items} >= $R->{freeOver} && $payable < $R->{freeOver} && $t->{shipping} == 0) {
    ok("(a) items $t->{items} >= $R->{freeOver}, payable $payable < $R->{freeOver}, "
     . "shipping still 0 -- the threshold is PRE-coupon");
  } else {
    fail("(a) items $t->{items}, payable $payable, shipping $t->{shipping} -- "
       . "the free-shipping threshold is being measured AFTER the coupon");
  }
}

# (b) maxOff caps the discount, after rounding.
{
  my $devi10 = (grep { $_->{code} eq 'DEVI10' } @codes)[0];
  # 3 x 5499 = 16497; 10% = 1650, which must be capped to maxOff 1000.
  my $t = totals([{ pid => 'p-qt-kantha-patchwork', qty => 3 }], $devi10);
  if ($t->{discount} == $devi10->{maxOff}) {
    ok("(b) 10% of $t->{items} capped to maxOff $devi10->{maxOff}");
  } else {
    fail("(b) discount $t->{discount} ignored maxOff $devi10->{maxOff}");
  }
}

# (c) minItems is measured on items BEFORE the discount, so a code cannot
#     unlock itself.
{
  my $fest = (grep { $_->{code} eq 'FESTIVE15' } @codes)[0];
  my $under = totals([{ pid => 'p-bc-bagru-floral', qty => 1 }], $fest);   # 2899 < 4000
  my $over  = totals([{ pid => 'p-bc-bagru-floral', qty => 2 }], $fest);   # 5798 >= 4000
  if (!$under->{couponOk} && $under->{discount} == 0 && $over->{couponOk}) {
    ok("(c) minItems $fest->{minItems}: 2899 rejected, 5798 accepted");
  } else {
    fail("(c) minItems gate is wrong: under=$under->{couponOk} over=$over->{couponOk}");
  }
}

# (d) Two colours of one product are TWO lines. If line identity were the
#     product id, the second add would silently increment the first and the
#     customer would receive two of the wrong colour.
{
  my $two = totals([
    { pid => 'p-bc-kalamkari-indigo', qty => 1, size => 'dbl'  },
    { pid => 'p-bc-kalamkari-indigo', qty => 1, size => 'king' },
  ]);
  my $p = $BY{'p-bc-kalamkari-indigo'};
  my $want = unit_price($p, 'dbl') + unit_price($p, 'king');
  if ($two->{items} == $want) {
    ok("(d) two variants of one product total $want, not " . (2 * $p->{price}));
  } else {
    fail("(d) two variants totalled $two->{items}, expected $want");
  }
}

# (e) bulkySurcharge applies once per bulky LINE, not per unit. Three of one
#     oversized thing in a line is one handling charge, not three.
{
  my $one   = totals([{ pid => 't-bulky', qty => 1 }]);
  my $three = totals([{ pid => 't-bulky', qty => 3 }]);
  if ($one->{bulky} == $R->{bulkySurcharge} && $three->{bulky} == $R->{bulkySurcharge}) {
    ok("(e) bulky surcharge $R->{bulkySurcharge} charged once per line, not per unit");
  } else {
    fail("(e) bulky: qty1=$one->{bulky} qty3=$three->{bulky}, "
       . "expected $R->{bulkySurcharge} for both");
  }
}

# (f) A voucher-only basket ships nothing, so it is never charged shipping even
#     below the threshold. There is no parcel.
{
  my $t = totals([{ pid => 't-voucher', qty => 1 }]);
  if ($t->{shipping} == 0 && $t->{physical} == 0) {
    ok('(f) a voucher-only basket is not charged shipping');
  } else {
    fail("(f) voucher basket charged shipping $t->{shipping}");
  }
}

# ---------------------------------------------------------------------------
# THE SOURCE CHECK -- what would have caught kirana's bug.
#
# The maths above proves the SPEC. This proves the IMPLEMENTATION still agrees
# with it, by reading the line of domain.js that decides free shipping and
# failing if it references anything post-discount.
# ---------------------------------------------------------------------------
sub check_source {
  open my $fh, '<:encoding(UTF-8)', "$APP/domain.js" or do {
    fail('cannot read app/domain.js'); return;
  };
  local $/; my $src = <$fh>; close $fh;

  my ($fn) = $src =~ /export function totals\s*\([^)]*\)\s*\{(.*?)\n\}/s;
  unless ($fn) { fail('could not find totals() in domain.js'); return; }

  my ($line) = $fn =~ /^(.*freeShip\s*=.*)$/m;
  unless ($line) { fail('could not find the freeShip line in totals()'); return; }

  $line =~ s/^\s+|\s+$//g;
  if ($line =~ /\b(payable|afterDiscount|net|grand)\b/) {
    fail("domain.js computes free shipping from a POST-discount value:\n      $line\n"
       . "      It must use `items`. This is kirana's live bug; see the header.");
  } elsif ($line =~ /\bitems\b/) {
    ok("domain.js measures free shipping on `items` -- $line");
  } else {
    fail("the freeShip line names neither items nor a known post-discount "
       . "value, so this check can no longer see what it does:\n      $line");
  }

  fail('domain.js applies the coupon per line instead of once on the total')
    if $fn =~ /lines\.(map|forEach)[^;]*percent/s;
}
print "\n";
check_source();

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all money checks passed\n";
exit 0;
