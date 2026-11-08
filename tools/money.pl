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
# A shop with a real fee above a real threshold would turn the same drift into
# a live arithmetic error on day one. Case (a) below pins the rule,
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

# See the long note above the named cases: the live rules make the threshold
# unreachable, so every threshold assertion in this file runs against these as
# well. Declared here because the random baskets use them too.
my $SYNTH = { fee => 99, freeOver => 1999, bulkySurcharge => 250,
              freeOverBasis => 'items' };

printf "fee %d, freeOver %d (%s), bulky %d, %d products\n",
  $R->{fee}, $R->{freeOver}, $R->{freeOverBasis}, $R->{bulkySurcharge}, scalar @P;
printf "synthetic: fee %d, freeOver %d, bulky %d\n\n",
  $SYNTH->{fee}, $SYNTH->{freeOver}, $SYNTH->{bulkySurcharge};

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
  my ($lines, $coupon, $rules) = @_;
  $rules ||= $R;
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
      $bulky += $rules->{bulkySurcharge} if ($p->{shipClass} // 'std') eq 'bulky';
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
  my $free = ($physical == 0 || $items >= $rules->{freeOver});
  my $ship = $free ? 0 : $rules->{fee};

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
  #
  # ⚠️ Run against the SYNTHETIC rules as well as the live ones. Against the
  # live rules alone this is vacuous: freeOver is 0, so `items >= freeOver` is
  # true for every basket that can exist and the second branch is unreachable.
  # 500 baskets of a condition that cannot fail is 500 baskets of nothing. See
  # the $SYNTH note below the loop.
  for my $rules ($R, $SYNTH) {
    my $tt = ($rules == $R) ? $t : totals(\@lines, $coupon, $rules);
    next unless $tt->{physical} > 0;
    $bad++, fail("basket $n: items $tt->{items} >= $rules->{freeOver} but "
               . "shipping $tt->{shipping} charged")
      if $tt->{items} >= $rules->{freeOver} && $tt->{shipping} != 0;
    $bad++, fail("basket $n: items $tt->{items} < $rules->{freeOver} but "
               . "shipping was free")
      if $tt->{items} < $rules->{freeOver} && $tt->{shipping} != $rules->{fee};
  }
  last if $bad > 4;
}
ok('500 random baskets reconcile, all integers, under live AND synthetic '
 . 'shipping rules') unless $bad;

# ---------------------------------------------------------------------------
# THE NAMED CASES
# ---------------------------------------------------------------------------
print "\n";

# ---------------------------------------------------------------------------
# SYNTHETIC SHIPPING RULES -- and this is the most important block in the file.
#
# ⚠️ THIS SHOP DELIVERS FREE. fee 0, freeOver 0. That makes the free-shipping
# threshold rule DORMANT: every basket clears a threshold of zero, so a test
# written against the live numbers passes whatever domain.js does, and would go
# on passing if somebody moved the measurement to the post-coupon total
# tomorrow.
#
# That is not a hypothetical. It is precisely how kirana hid a real bug for
# months -- its domain.js measured the threshold AFTER the coupon and its
# money.pl measured it BEFORE, and both were invisible because both numbers
# were zero. It took a shop with a real Rs 99 fee to bring the
# disagreement to light.
#
# So the threshold cases below run against a SYNTHETIC fee and threshold. The
# rule stays tested even though the shop does not charge for delivery, and the
# day the owner introduces a delivery charge the arithmetic behind it has
# already been proved rather than written fresh under time pressure.
#
# Same reasoning as the two synthetic PRODUCTS below, and the same lesson:
# a live rule with no live example still gets a test.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# TWO SYNTHETIC PRODUCTS, for the rules the catalogue does not exercise.
#
# ⚠️ Deliberate, not laziness. Nothing in a clothes catalogue is `bulky` and
# nothing is a `voucher`, but both branches are still live in domain.js and in
# shop.json. Aiming these cases at a REAL product is how a suite goes blind:
# delist the product and the suite goes on reporting green while testing
# nothing.
# ---------------------------------------------------------------------------
$BY{'t-bulky'}   = { id => 't-bulky',   price => 4000, mrp => 4000,
                     kind => 'goods',   shipClass => 'bulky' };
$BY{'t-voucher'} = { id => 't-voucher', price => 1000, mrp => 1000,
                     kind => 'voucher', shipClass => 'std'   };

# Three SIZED synthetic garments, for the named cases below (8 November 2026).
# They aimed at real products until the store page could change a price: a
# case built on "the kurti costs 999" breaks the day the owner reprices it,
# and one built on a product the owner retires dies with it. The arithmetic
# under test is the same for any garment, so the garments are made up here.
my @SIZED = ({ id => 's', delta => 0 }, { id => 'm', delta => 0 }, { id => 'xxl', delta => 100 });
$BY{'t-top'}   = { id => 't-top',   price => 999,  mrp => 1499, kind => 'goods', shipClass => 'std',
                   variants => { size => [ @SIZED ] } };
$BY{'t-dress'} = { id => 't-dress', price => 1899, mrp => 2599, kind => 'goods', shipClass => 'std',
                   variants => { size => [ @SIZED ] } };
$BY{'t-shirt'} = { id => 't-shirt', price => 1299, mrp => 1799, kind => 'goods', shipClass => 'std',
                   variants => { size => [ @SIZED ] } };

# (a) THE ONE THAT MATTERS. A basket just over the threshold, with a percentage
#     coupon that drops the payable BELOW it. Free shipping must survive --
#     the customer had already earned it before the code was applied.
#
#     Two SIZES of the synthetic top: 1099 (XXL, +100) + 999 (S) = 2098, which clears
#     the synthetic 1999 on items. VASTRA10 takes 210 off, so the payable is
#     1888 -- back under. That straddle is the whole test; a basket that does
#     not cross back under proves nothing.
{
  my $c10 = (grep { $_->{code} eq 'VASTRA10' } @codes)[0];
  my $t = totals([{ pid => 't-top', qty => 1, size => 'xxl' },
                  { pid => 't-top', qty => 1, size => 's'   }],
                 $c10, $SYNTH);
  my $payable = $t->{items} - $t->{discount};
  if ($t->{items} >= $SYNTH->{freeOver} && $payable < $SYNTH->{freeOver}
      && $t->{shipping} == 0) {
    ok("(a) items $t->{items} >= $SYNTH->{freeOver}, payable $payable < "
     . "$SYNTH->{freeOver}, shipping still 0 -- the threshold is PRE-coupon "
     . "(synthetic rules; this shop delivers free)");
  } else {
    fail("(a) items $t->{items}, payable $payable, shipping $t->{shipping} -- "
       . "the free-shipping threshold is being measured AFTER the coupon");
  }
}

# (b) maxOff caps the discount, after rounding.
{
  my $c10 = (grep { $_->{code} eq 'VASTRA10' } @codes)[0];
  # 3 x 1899 = 5697; 10% = 570, which must be capped to maxOff 500.
  my $t = totals([{ pid => 't-dress', qty => 3 }], $c10);
  if ($t->{discount} == $c10->{maxOff}) {
    ok("(b) 10% of $t->{items} capped to maxOff $c10->{maxOff}");
  } else {
    fail("(b) discount $t->{discount} ignored maxOff $c10->{maxOff}");
  }
}

# (c) minItems is measured on items BEFORE the discount, so a code cannot
#     unlock itself.
{
  my $fest = (grep { $_->{code} eq 'FESTIVE15' } @codes)[0];
  my $under = totals([{ pid => 't-dress', qty => 1 }], $fest); # 1899 < 3000
  my $over  = totals([{ pid => 't-dress', qty => 2 }], $fest); # 3798 >= 3000
  if (!$under->{couponOk} && $under->{discount} == 0 && $over->{couponOk}) {
    ok("(c) minItems $fest->{minItems}: $under->{items} rejected, "
     . "$over->{items} accepted");
  } else {
    fail("(c) minItems gate is wrong: under=$under->{couponOk} over=$over->{couponOk}");
  }
}

# (d) Two SIZES of one garment are TWO lines. If line identity were the product
#     id, the second add would silently increment the first and the customer
#     would receive two of the wrong size -- the single most likely way to turn
#     one sale into one return.
{
  my $two = totals([
    { pid => 't-shirt', qty => 1, size => 's'   },
    { pid => 't-shirt', qty => 1, size => 'xxl' },
  ]);
  my $p = $BY{'t-shirt'};
  my $want = unit_price($p, 's') + unit_price($p, 'xxl');
  if ($two->{items} == $want) {
    ok("(d) two sizes of one shirt total $want, not " . (2 * $p->{price}));
  } else {
    fail("(d) two sizes totalled $two->{items}, expected $want");
  }
}

# (e) ONLY THE SIZE AXIS MOVES THE PRICE, and it moves it by exactly the
#     declared delta. The rule that makes a garment shop different from a
#     grocery, checked on every product rather than asserted once.
{
  my $bad = 0;
  for my $p (@P) {
    my $base = $p->{price};
    for my $s (@{ $p->{variants}{size} || [] }) {
      my $got  = unit_price($p, $s->{id});
      my $want = $base + ($s->{delta} // 0);
      $bad++, fail("(e) $p->{id} size $s->{id}: unit $got, expected $want")
        if $got != $want;
    }
    # A colour must not move it at all. data.pl fails on a non-zero colour
    # delta in the JSON; this proves the ARITHMETIC ignores one even if it
    # somehow got there.
    for my $c (@{ $p->{variants}{colour} || [] }) {
      my $t = totals([{ pid => $p->{id}, qty => 1 }]);
      $bad++, fail("(e) $p->{id}: colour $c->{id} moved the price")
        if $t->{items} != $base;
    }
  }
  ok('(e) every size delta is exact and no colour moves the price') unless $bad;
}

# (f) bulkySurcharge applies once per bulky LINE, not per unit. Synthetic
#     rules: this shop charges nothing for an oversized item because it does
#     not sell one, but the branch is live.
{
  my $one   = totals([{ pid => 't-bulky', qty => 1 }], undef, $SYNTH);
  my $three = totals([{ pid => 't-bulky', qty => 3 }], undef, $SYNTH);
  if ($one->{bulky} == $SYNTH->{bulkySurcharge}
      && $three->{bulky} == $SYNTH->{bulkySurcharge}) {
    ok("(f) bulky surcharge $SYNTH->{bulkySurcharge} charged once per line, "
     . "not per unit (synthetic)");
  } else {
    fail("(f) bulky: qty1=$one->{bulky} qty3=$three->{bulky}, "
       . "expected $SYNTH->{bulkySurcharge} for both");
  }
}

# (g) A voucher-only basket ships nothing, so it is never charged shipping even
#     below the threshold. There is no parcel. Synthetic rules, or a fee of
#     zero would make this pass without testing anything.
{
  my $t = totals([{ pid => 't-voucher', qty => 1 }], undef, $SYNTH);
  if ($t->{shipping} == 0 && $t->{physical} == 0) {
    ok('(g) a voucher-only basket is not charged shipping (synthetic fee 99)');
  } else {
    fail("(g) voucher basket charged shipping $t->{shipping}");
  }
}

# (h) The shop as it actually ships: delivery is free on everything, including
#     the smallest possible basket. If somebody puts a fee back in shop.json
#     without meaning to, this is what says so.
{
  my $cheapest = (sort { $a->{price} <=> $b->{price} } @P)[0];
  my $t = totals([{ pid => $cheapest->{id}, qty => 1 }]);
  if ($t->{shipping} == 0) {
    ok("(h) live rules: a $t->{items} basket still ships free");
  } else {
    fail("(h) live rules charged $t->{shipping} on a $t->{items} basket -- "
       . "shop.json says delivery is free");
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
