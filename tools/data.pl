#!/usr/bin/perl
# Catalogue, category and shop-config integrity.
#
#   perl tools/data.pl [path/to/catalog.json]
#
# The optional path is what makes the admin's export safe: an exported
# catalogue is validated with the FULL rule set -- images on disk, price <= mrp,
# slug uniqueness, subcategory parentage -- BEFORE it replaces the real file.
#
# This script also carries the honesty flags. They FAIL the build on purpose:
# a phone number that does not dial and a demo UPI id on a live handle are the
# worst things to ship by accident, so they are made impossible rather than
# merely inadvisable.
use strict;
use warnings;
use JSON::PP;

my $root = $0; $root =~ s{[/\\]tools[/\\]data\.pl$}{};
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
sub load {
  my ($p) = @_;
  my $t = slurp($p);
  my $d = eval { JSON::PP->new->utf8(0)->decode($t) };
  die "$p is not valid JSON: $@" unless $d;
  return $d;
}

my $catalog_path = $ARGV[0] || "$APP/data/catalog.json";
my $cat  = load("$APP/data/categories.json");
my $cl   = load($catalog_path);
my $shop = load("$APP/data/shop.json");
# NOT `my $x = ... if ...` -- a conditional `my` is undefined behaviour in Perl
# and leaves the variable holding whatever was there last call.
my $pages;
$pages = load("$APP/data/pages.json") if -f "$APP/data/pages.json";

print "reading $catalog_path\n\n";

# ---------------------------------------------------------------------------
# CATEGORIES
# ---------------------------------------------------------------------------
my (%cat_ids, %sub_ids, %sub_parent, %slugs, %cat_leaf);
my $nsub = 0;
for my $c (@{ $cat->{categories} }) {
  fail("duplicate category id $c->{id}") if $cat_ids{ $c->{id} }++;
  fail("category $c->{id} slug '$c->{slug}' is not [a-z0-9-]")
    unless $c->{slug} =~ /^[a-z0-9-]+$/;
  fail("duplicate slug $c->{slug}") if $slugs{ $c->{slug} }++;
  for my $s (@{ $c->{sub} }) {
    fail("duplicate subcategory id $s->{id}") if $sub_ids{ $s->{id} }++;
    fail("sub $s->{id} slug '$s->{slug}' is not [a-z0-9-]")
      unless $s->{slug} =~ /^[a-z0-9-]+$/;
    $sub_parent{ $s->{id} } = $c->{id};
    $nsub++;
  }
  # A LEAF category holds its products directly -- Bedcovers & Quilts and
  # Table Runners both do. The two shapes are checked differently below.
  $cat_leaf{ $c->{id} } = @{ $c->{sub} || [] } ? 0 : 1;
}
my $ncat = scalar keys %cat_ids;
# Printed, not just counted: a dropped subcategory should be VISIBLE rather
# than silently making a sidebar one row shorter.
ok("$ncat categories, $nsub subcategories");
fail("expected 4 categories, found $ncat") unless $ncat == 4;
fail("expected 5 subcategories, found $nsub") unless $nsub == 5;

# ---------------------------------------------------------------------------
# PRODUCTS
# ---------------------------------------------------------------------------
my %DERIVED = map { $_ => 1 } qw(new sale low-stock sold-out);
my (%pid, %pslug, %sub_count);
my $nprod = 0;

for my $p (@{ $cl->{products} }) {
  my $id = $p->{id} // '(no id)';
  $nprod++;

  fail("duplicate product id $id") if $pid{$id}++;
  fail("$id: slug '$p->{slug}' is not [a-z0-9-]")
    unless ($p->{slug} // '') =~ /^[a-z0-9-]+$/;
  fail("$id: duplicate slug $p->{slug}") if $pslug{ $p->{slug} // '' }++;

  # Parentage. A product whose sub does not belong to its cat renders under a
  # category nobody can navigate to.
  my $pcat = $p->{cat} // '';
  if (!$cat_ids{$pcat}) {
    fail("$id: unknown category '$pcat'");
  } elsif ($cat_leaf{$pcat}) {
    # `sub` is not merely optional here, it is FORBIDDEN. A leftover sub
    # from a reorganised tree points at another category's child, and the
    # product then files itself under a heading nobody can navigate to.
    if (defined $p->{sub}) {
      fail("$id: cat '$pcat' has no subcategories, so `sub` must be absent"
         . " -- found '$p->{sub}'");
    } else {
      $sub_count{$pcat}++;
    }
  } elsif (!defined $p->{sub}) {
    fail("$id: cat '$pcat' has subcategories, so `sub` is required");
  } elsif (!$sub_ids{ $p->{sub} }) {
    fail("$id: unknown subcategory '$p->{sub}'");
  } elsif (($sub_parent{ $p->{sub} } // '') ne $pcat) {
    fail("$id: sub '$p->{sub}' belongs to '$sub_parent{$p->{sub}}', not '$pcat'");
  } else {
    $sub_count{ $p->{sub} }++;
  }

  # Money. Integer rupees, no floats anywhere.
  for my $k (qw(mrp price)) {
    my $v = $p->{$k};
    fail("$id: $k '$v' is not a whole rupee")
      unless defined $v && $v =~ /^\d+$/;
  }
  fail("$id: price $p->{price} is above mrp $p->{mrp}")
    if defined $p->{price} && defined $p->{mrp} && $p->{price} > $p->{mrp};

  fail("$id: popularity '" . ($p->{popularity} // '') . "' outside 0-100")
    unless defined $p->{popularity} && $p->{popularity} =~ /^\d+$/
        && $p->{popularity} <= 100;

  fail("$id: addedOn '" . ($p->{addedOn} // '') . "' is not YYYY-MM-DD")
    unless ($p->{addedOn} // '') =~ /^\d{4}-\d{2}-\d{2}$/;

  for my $k (qw(name shortDesc desc slug kind shipClass)) {
    fail("$id: missing $k") unless defined $p->{$k} && length $p->{$k};
  }
  fail("$id: kind '" . ($p->{kind} // '') . "' is not goods or voucher")
    unless ($p->{kind} // '') =~ /^(goods|voucher)$/;
  fail("$id: shipClass '" . ($p->{shipClass} // '') . "' is not std or bulky")
    unless ($p->{shipClass} // '') =~ /^(std|bulky)$/;

  # A voucher has no stock, because there is nothing to run out of. Goods must
  # declare it, because a missing stock field renders as sold out.
  if (($p->{kind} // '') eq 'voucher') {
    fail("$id: a voucher must not declare stock") if exists $p->{stock};
  } else {
    fail("$id: goods must declare stock")
      unless defined $p->{stock} && $p->{stock} =~ /^\d+$/;
  }

  # Badges hold only what a human chose.
  for my $b (@{ $p->{badges} || [] }) {
    fail("$id: '$b' is DERIVED and must not be stored in badges") if $DERIVED{$b};
  }

  # Variants.
  my $v = $p->{variants} || {};
  for my $c (@{ $v->{colour} || [] }) {
    fail("$id: colour '$c->{id}' swatch '" . ($c->{swatch} // '') . "' is not a hex")
      unless ($c->{swatch} // '') =~ /^#[0-9A-Fa-f]{6}$/;
    # Only the size axis may move the price.
    fail("$id: colour '$c->{id}' carries a non-zero delta -- only size may")
      if ($c->{delta} // 0) != 0;
  }
  for my $s (@{ $v->{size} || [] }) {
    my $d = $s->{delta};
    fail("$id: size '$s->{id}' delta '" . ($d // '') . "' is not a whole number")
      unless defined $d && $d =~ /^-?\d+$/;
    fail("$id: size '$s->{id}' makes the price zero or negative")
      if defined $d && defined $p->{price} && ($p->{price} + $d) <= 0;
  }

  # Specs.
  fail("$id: no specs") unless @{ $p->{specs} || [] };
  for my $sp (@{ $p->{specs} || [] }) {
    fail("$id: a spec is missing k or v")
      unless defined $sp->{k} && length $sp->{k}
          && defined $sp->{v} && length $sp->{v};
  }

  # Images, when a photograph has been dropped in. A 404 shows a broken-image
  # glyph on a premium storefront, which is strictly worse than the generated
  # artwork it replaced.
  my $imgs = $p->{img};
  if ($imgs && ref $imgs eq 'ARRAY') {
    for my $i (0 .. $#$imgs) {
      my $src = $imgs->[$i];
      next unless defined $src && length $src;   # null = stays generated
      fail("$id: image[$i] '$src' is not on disk at app/$src")
        unless -f "$APP/$src";
    }
  }
}
ok("$nprod products");

# Every subcategory must have something in it -- an empty one is a dead link in
# the sidebar, which is worse than not listing it.
for my $s (sort keys %sub_ids) {
  fail("subcategory '$s' has no products") unless $sub_count{$s};
}
# And a leaf category is a dead link for exactly the same reason.
for my $c (sort grep { $cat_leaf{$_} } keys %cat_leaf) {
  fail("category '$c' has no subcategories AND no products")
    unless $sub_count{$c};
}

# ---------------------------------------------------------------------------
# SHOP CONFIG
# ---------------------------------------------------------------------------
my $sh = $shop->{shipping};
for my $k (qw(fee freeOver bulkySurcharge minOrder)) {
  fail("shipping.$k '" . ($sh->{$k} // '') . "' is not a whole rupee")
    unless defined $sh->{$k} && $sh->{$k} =~ /^\d+$/;
}
fail("shipping.freeOverBasis must be 'items' -- see the note in shop.json")
  unless ($sh->{freeOverBasis} // '') eq 'items';

my $seen_code = {};
for my $c (@{ $shop->{coupons}{codes} || [] }) {
  my $code = $c->{code} // '(no code)';
  fail("coupon $code: duplicate") if $seen_code->{ uc $code }++;
  my $pc = $c->{percent} || 0;
  my $fl = $c->{flat} || 0;
  # Exactly one. Both is ambiguous; neither is a code that does nothing.
  fail("coupon $code: has BOTH percent and flat") if $pc && $fl;
  fail("coupon $code: has NEITHER percent nor flat") if !$pc && !$fl;
  fail("coupon $code: percent $pc is outside 1-100") if $pc && ($pc < 1 || $pc > 100);
  for my $k (qw(minItems maxOff)) {
    fail("coupon $code: $k is not a whole rupee")
      unless defined $c->{$k} && $c->{$k} =~ /^\d+$/;
  }
}
ok(scalar(@{ $shop->{coupons}{codes} || [] }) . " coupon codes");

# ---------------------------------------------------------------------------
# pages.json -- the fromShop interpolation.
# This is what stops the Shipping policy page and the cart arithmetic
# disagreeing: a bad path is a check failure, not an embarrassment.
# ---------------------------------------------------------------------------
if ($pages) {
  my $nblock = 0;
  for my $key (sort keys %{ $pages->{pages} }) {
    my $pg = $pages->{pages}{$key};
    fail("page $key: no title") unless ($pg->{title} // '') ne '';
    for my $b (@{ $pg->{blocks} || [] }) {
      $nblock++;
      next unless ($b->{t} // '') eq 'fromShop';
      my $cur = $shop;
      for my $seg (split /\./, $b->{v}) {
        $cur = ref $cur eq 'HASH' ? $cur->{$seg} : undef;
      }
      fail("page $key: fromShop path '$b->{v}' does not resolve in shop.json")
        unless defined $cur;
    }
  }
  ok(scalar(keys %{ $pages->{pages} }) . " content pages, $nblock blocks");
}

# ---------------------------------------------------------------------------
# THE HONESTY FLAGS -- these fail on purpose.
# ---------------------------------------------------------------------------
print "\n";

# The brand band's logo. Empty is fine and is what ships -- the drawn lockup is
# used. A path that is NOT on disk is not fine: it renders as a broken image in
# the single most prominent position on every page.
my $logo = $shop->{brand}{logo} // '';
if ($logo eq '') {
  ok('brand.logo is empty; the drawn lockup is used');
} elsif ($logo =~ m{^(?:/|[a-z]+:)}i) {
  fail("brand.logo '$logo' must be relative to app/ -- a leading slash breaks "
     . "on GitHub Pages, which serves this site from a subpath");
} elsif (!-f "$APP/$logo") {
  fail("brand.logo '$logo' is not a file at app/$logo");
} else {
  ok("brand.logo $logo is on disk");
}

if ($shop->{placeholder}) {
  fail("shop.json placeholder is TRUE -- the brand details, phone, address, "
     . "GSTIN and all prices are invented.\n"
     . "      This is deliberate and this check is the point: fill in `contact`,\n"
     . "      check the prices, then set placeholder to false.");
} else {
  for my $k (qw(phone email addr city state pin)) {
    fail("placeholder is false but contact.$k is empty")
      unless ($shop->{contact}{$k} // '') ne '';
  }
  ok('placeholder is false and every contact field is filled');
}

my $upi = $shop->{upi} || {};
if ($upi->{demo}) {
  my ($handle) = ($upi->{vpa} // '') =~ /\@(.+)$/;
  $handle = lc($handle // '');
  # A demo id on a REAL handle could send a customer's money to whoever owns it.
  my @real = qw(ybl okaxis okhdfcbank okicici oksbi paytm apl ibl axl upi
                airtel freecharge jio fbl yapl);
  if (grep { $_ eq $handle } @real) {
    fail("upi.demo is true but '$handle' is a REAL UPI handle -- money could "
       . "actually move to whoever owns that id");
  } else {
    ok("upi is a demo id on the unresolvable handle '\@$handle'");
  }
} else {
  fail('upi.demo is false but upi.vpa is empty') unless ($upi->{vpa} // '') ne '';
}

my $gw = $shop->{gateway} || {};
if ($gw->{live}) {
  # A gateway with no server cannot verify a payment, and it must not be
  # possible to flip one boolean and have the site start claiming otherwise.
  fail('gateway.live is true but serverBase is empty -- a payment cannot be '
     . 'verified without a server')
    unless ($gw->{serverBase} // '') ne '';
  fail('gateway.live is true with an rzp_test_ key')
    if ($gw->{keyId} // '') =~ /^rzp_test_/;
} else {
  ok('gateway is off; card and net banking ship disabled with their reason');
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all data checks passed\n";
exit 0;
