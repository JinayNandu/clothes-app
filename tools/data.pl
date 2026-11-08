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

# The size charts live in shop.json rather than on each product: a shirt in M
# is the same M across every shirt on this floor, and repeating five rows on
# every product is how the numbers drift apart. Hoisted here because the
# product loop checks each product against them.
my $charts = $shop->{sizeCharts} || {};

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
  # A LEAF category holds its products directly. None does today -- both Men
  # and Women have children -- but the branch is live in sidebar.js and the
  # two shapes are checked differently below.
  $cat_leaf{ $c->{id} } = @{ $c->{sub} || [] } ? 0 : 1;
}
my $ncat = scalar keys %cat_ids;

# ---------------------------------------------------------------------------
# THE TREE IS THE EXPECTED SIZE.
#
# ⚠️ BUMP THESE TWO NUMBERS DELIBERATELY WHEN THE TREE GROWS. They are here to
# catch a category or a subcategory that DISAPPEARS -- a bad merge, a stray
# edit, an admin export written back with a branch missing -- which otherwise
# shows up as a sidebar one row shorter that nobody notices for a week.
#
# They are declared up here, named, rather than written inline,
# because a magic number buried in a condition is one people edit
# without reading and then the check means nothing. If you are changing these,
# you should be adding or removing a category on purpose.
# ---------------------------------------------------------------------------
my $EXPECT_CATS = 2;    # Men, Women
my $EXPECT_SUBS = 5;    # Shirts | Dresses, Tops and shirts, Trousers and shorts,
                        # Jumpsuits and sets -- the owner's own photographs,
                        # 8 November 2026, had no kurtis in them

# Printed, not just counted: a dropped subcategory should be VISIBLE rather
# than silently making a sidebar one row shorter.
ok("$ncat categories, $nsub subcategories");
fail("expected $EXPECT_CATS categories, found $ncat -- if this is deliberate, "
   . "bump \$EXPECT_CATS in tools/data.pl") unless $ncat == $EXPECT_CATS;
fail("expected $EXPECT_SUBS subcategories, found $nsub -- if this is "
   . "deliberate, bump \$EXPECT_SUBS in tools/data.pl") unless $nsub == $EXPECT_SUBS;

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

  # A voucher has no stock, because there is nothing to run out of. Goods
  # declare the stock of EACH COLOUR IN EACH SIZE (8 November 2026): a shop
  # that knows only "24 shirts" sells an XXL it does not have. `stock` itself
  # is their sum, worked out as the catalogue loads (domain.js withStock), so
  # it must NOT be stored -- a stored total disagrees with its sizes the first
  # time either is edited.
  fail("$id: `stock` is derived from skus and must not be stored") if exists $p->{stock};
  if (($p->{kind} // '') eq 'voucher') {
    fail("$id: a voucher must not declare skus") if exists $p->{skus};
  } else {
    # The keys, exactly as domain.js skuKey() makes them: colour/size, the one
    # axis alone, or `one` for a product with neither.
    my @cs = map { $_->{id} } @{ ($p->{variants} || {})->{colour} || [] };
    my @ss = map { $_->{id} } @{ ($p->{variants} || {})->{size} || [] };
    my @want = @cs && @ss ? (map { my $c = $_; map { "$c/$_" } @ss } @cs)
             : @cs ? @cs : @ss ? @ss : ('one');
    my $sk = $p->{skus};
    if (ref $sk ne 'HASH') {
      fail("$id: goods must declare skus, the stock of each colour and size");
    } else {
      my %want = map { $_ => 1 } @want;
      for my $k (@want) {
        fail("$id: skus has no '$k' -- every colour and size is listed, 0 when there is none")
          unless exists $sk->{$k};
      }
      for my $k (sort keys %$sk) {
        fail("$id: skus '$k' is not a colour/size this product sells") unless $want{$k};
        fail("$id: skus '$k' is '" . ($sk->{$k} // '') . "', not a whole number of pieces")
          unless defined $sk->{$k} && $sk->{$k} =~ /^\d+$/;
      }
    }
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

  # -------------------------------------------------------------------------
  # THE SIZE CHART COVERS EVERY SIZE THIS PRODUCT SELLS.
  #
  # ⚠️ The cheapest return prevention there is, so a gap in it is not cosmetic.
  # A size with no row renders a BLANK LINE in the table on the product page,
  # which is worse than showing no table at all: the customer reads a blank
  # row as "no measurement needed for XXL" rather than as a missing number,
  # orders it, and the return that follows costs more than this check.
  #
  # Row keys are the size IDS from this file, not the labels, so renaming a
  # label never silently detaches the measurements from the size.
  # -------------------------------------------------------------------------
  my @sizes = @{ $v->{size} || [] };
  if (@sizes) {
    my $cname = $p->{sizeChart};
    if (!defined $cname || !length $cname) {
      fail("$id: sells sizes but names no sizeChart");
    } elsif (!$charts->{$cname}) {
      fail("$id: sizeChart '$cname' is not in shop.json sizeCharts");
    } else {
      my $ch   = $charts->{$cname};
      my $ncol = scalar @{ $ch->{cols} || [] };
      fail("sizeChart '$cname': no cols") unless $ncol;
      for my $s (@sizes) {
        my $row = $ch->{rows}{ $s->{id} };
        if (!$row) {
          fail("$id: size '$s->{id}' has no row in sizeChart '$cname'");
          next;
        }
        fail("sizeChart '$cname' row '$s->{id}': "
           . scalar(@$row) . " values for $ncol columns")
          unless scalar(@$row) == $ncol;
        for my $m (@$row) {
          # Inches, so NOT the whole-rupee rule: half an inch is a real
          # grading step and 14.5 must be allowed through.
          fail("sizeChart '$cname' row '$s->{id}': '"
             . (defined $m ? $m : '') . "' is not a measurement")
            unless defined $m && $m =~ /^\d+(?:\.\d+)?$/ && $m > 0;
        }
      }
    }
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

# ---------------------------------------------------------------------------
# THE DELIVERY PROMISE
#
# ⚠️ A range that runs backwards prints "Arrives 15-10 November", which reads
# as a broken shop rather than as a bad number in a JSON file. domain.js
# clamps it as well, so the customer never sees it either way -- but a value
# silently corrected at render is a value nobody ever fixes at source.
# ---------------------------------------------------------------------------
my $dd = $sh->{deliveryDays} || {};
for my $k (qw(min max)) {
  fail("shipping.deliveryDays.$k '" . ($dd->{$k} // '') . "' is not a whole "
     . "number of days")
    unless defined $dd->{$k} && $dd->{$k} =~ /^\d+$/ && $dd->{$k} >= 1;
}
fail("shipping.deliveryDays: min $dd->{min} is above max $dd->{max} -- the "
   . "range would print backwards")
  if ($dd->{min} // 0) =~ /^\d+$/ && ($dd->{max} // 0) =~ /^\d+$/
     && $dd->{min} > $dd->{max};
fail("shipping.deliveryDays.basis '" . ($dd->{basis} // '') . "' is not "
   . "'working' or 'calendar'")
  unless ($dd->{basis} // '') =~ /^(working|calendar)$/;

# ---------------------------------------------------------------------------
# THE RETURN WINDOW
#
# ⚠️ `from` MUST be `delivery`. Counted from placement, a seven-day window on
# a parcel that takes ten working days to arrive would EXPIRE BEFORE IT
# LANDED -- the customer would receive a garment they were already unable to
# send back. This check is the only thing standing between that and a
# one-word edit, so it fails loudly rather than warning.
# ---------------------------------------------------------------------------
my $rt = $shop->{returns} || {};
fail("returns.days '" . ($rt->{days} // '') . "' is not a whole number of days")
  unless defined $rt->{days} && $rt->{days} =~ /^\d+$/ && $rt->{days} >= 1;
fail("returns.from is '" . ($rt->{from} // '') . "', NOT 'delivery' -- a "
   . "window counted from placement can expire before the parcel arrives")
  unless ($rt->{from} // '') eq 'delivery';
ok("returns: $rt->{days} days from delivery"
   . (($rt->{free} // 0) ? ', free' : ', customer pays'))
  if ($rt->{from} // '') eq 'delivery';

# ---------------------------------------------------------------------------
# EVERY SIZE-CHART COLUMN HAS A HOW-TO-MEASURE NOTE, AND SAYS WHETHER IT
# DESCRIBES THE BODY OR THE GARMENT.
#
# ⚠️ The body/garment distinction is the single most common way a customer
# orders the wrong size. "To fit chest 40" means the shirt fits a 40 in
# chest; the shirt itself measures more, because it needs ease. Somebody who
# measures a shirt they already own against a body column reads every size as
# too small and orders one up -- a return caused by the chart that was
# supposed to prevent it.
#
# Keyed on the column heading as sizeCharts spells it, so renaming a column
# fails here rather than quietly dropping its guidance out of the table.
# ---------------------------------------------------------------------------
{
  my $notes = $shop->{measureNotes} || {};
  my %used;
  for my $cn (sort keys %$charts) {
    for my $col (@{ $charts->{$cn}{cols} || [] }) {
      $used{$col} = 1;
      my $n = $notes->{$col};
      if (!$n) {
        fail("sizeChart '$cn': column '$col' has no entry in measureNotes");
        next;
      }
      fail("measureNotes '$col': `on` is '" . ($n->{on} // '')
         . "', not 'body' or 'garment'")
        unless ($n->{on} // '') =~ /^(body|garment)$/;
      fail("measureNotes '$col': no `how`")
        unless defined $n->{how} && length $n->{how};
    }
  }
  for my $col (sort keys %$notes) {
    fail("measureNotes '$col' is not a column in any size chart -- delete it "
       . "or check the spelling against sizeCharts")
      unless $used{$col};
  }
  ok(scalar(keys %$notes) . " measure notes, one per size-chart column")
    if %$notes;
}

# Every chart is reachable from at least one product, and no chart is orphaned.
# An orphaned chart is measurements nobody maintains, which is how a chart
# that no longer matches the grading survives to be attached to a new product.
{
  my %used;
  $used{ $_->{sizeChart} } = 1 for grep { defined $_->{sizeChart} } @{ $cl->{products} };
  for my $cn (sort keys %$charts) {
    fail("sizeChart '$cn' is not used by any product -- delete it or attach it")
      unless $used{$cn};
  }
  ok(scalar(keys %$charts) . " size charts, all in use") if %$charts;
}

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

# Photographs. Every one shown is on disk and credited, every credit is shown,
# every file in app/img is used -- and a stock stand-in cannot outlive the
# placeholder flag. On a real shop a stand-in is a picture of a garment the
# customer will not receive, the one image a shop must never show.
{
  my $ph = $shop->{photos} || {};
  # The owner's own photographs (8 November 2026), declared once by folder: a
  # file there needs no credit of its own and is never stock. See
  # ownPhotosNote in shop.json for why a stand-in must never go in it.
  my $own = ($shop->{ownPhotos} || {})->{dir} // '';
  my $isOwn = sub { length $own && index($_[0], $own) == 0 };
  my (%used, $bad);
  for my $p (@{ $cl->{products} || [] }) {
    $used{$_} //= "product $p->{id}" for grep { defined && length } @{ $p->{img} || [] };
  }
  for my $c (@{ $cat->{categories} || [] }) { $used{ $c->{img} } //= "category $c->{id}" if $c->{img} }
  for my $k (sort keys %{ $shop->{hero} || {} }) { $used{ $shop->{hero}{$k} } //= "hero.$k" if $shop->{hero}{$k} }
  for my $path (sort keys %used) {
    my $who = $used{$path};
    if ($path !~ m{^img/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|avif)$}) {
      $bad++; fail("$who: '$path' must be a relative path under img/ -- a leading slash breaks on GitHub Pages");
    } elsif (!-f "$APP/$path") { $bad++; fail("$who: photograph '$path' is not on disk at app/$path") }
    unless ($ph->{$path} || $isOwn->($path)) { $bad++; fail("$who: '$path' has no entry in shop.json photos -- every photograph shown needs its credit") }
  }
  if (length $own && ($own !~ m{^img/[a-z0-9-]+/$} || !-d "$APP/$own")) {
    $bad++; fail("ownPhotos.dir '$own' must be a folder under img/, ending in a slash");
  }
  for my $path (sort keys %$ph) {
    my $e = $ph->{$path};
    if ($isOwn->($path)) { $bad++; fail("photos: '$path' is credited to someone, but it is in ownPhotos.dir -- a borrowed photograph does not go in the shop's own folder") }
    unless ($used{$path}) { $bad++; fail("photos: '$path' is credited but nothing shows it") }
    for my $f (qw(what by source license)) { unless (($e->{$f} // '') ne '') { $bad++; fail("photos: '$path' has no $f") } }
    if (($e->{source} // '') !~ m{^https://}) { $bad++; fail("photos: '$path' source is not an https link") }
  }
  my @files; my $walk; $walk = sub {
    my ($rel) = @_;
    opendir my $dh, "$APP/$rel" or return;
    for my $n (sort grep { !/^\./ } readdir $dh) {
      if (-d "$APP/$rel/$n") { $walk->("$rel/$n") } elsif ($n =~ /\.(?:jpe?g|png|webp|avif)$/i) { push @files, "$rel/$n" }
    }
    closedir $dh;
  };
  $walk->('img');
  for my $f (@files) {
    next if $used{$f} || $f eq ($shop->{brand}{logo} // '');
    $bad++; fail("app/$f is shown by nothing -- it would ship and never appear");
  }
  my @stock = grep { $ph->{$_} && $ph->{$_}{stock} } sort keys %used;
  if (@stock && !$shop->{placeholder}) {
    $bad++; fail(scalar(@stock) . ' stock photograph(s) still shown with placeholder false -- '
      . 'a stand-in shows a garment the customer will not receive: ' . join(', ', @stock));
  }
  ok(scalar(keys %used) . ' photographs shown, each on disk and credited'
     . (@stock ? '; ' . scalar(@stock) . ' are stock stand-ins, allowed only while placeholder is true' : '')) unless $bad;
}

if ($shop->{placeholder}) {
  fail("shop.json placeholder is TRUE -- the brand details, phone, address, "
     . "GSTIN and all prices are invented.\n"
     . "      This is deliberate and this check is the point: fill in `contact`,\n"
     . "      check the prices, then set placeholder to false.");
} else {
  for my $k (qw(phone email addr city state pin returnsAddr)) {
    fail("placeholder is false but contact.$k is empty")
      unless ($shop->{contact}{$k} // '') ne '';
  }
  ok('placeholder is false and every contact field is filled');
}

# THE DUMMY CONTACT DETAILS (7 November 2026, so the site shows its Call,
# WhatsApp and Email buttons in a demo). Chosen so a tap reaches NOBODY:
# 12345 67890 is not an Indian mobile (those start 6 to 9), so WhatsApp and the
# dialler refuse it, and example.com is reserved and takes no mail. A
# real-looking number would WhatsApp a stranger. They must never go live.
{
  my $c = $shop->{contact} || {};
  my @dummy;
  for my $k (qw(phone whatsapp)) {
    (my $d = $c->{$k} // '') =~ s/\D//g;
    push @dummy, "contact.$k" if $d =~ /1234567890$/;
  }
  push @dummy, 'contact.email' if ($c->{email} // '') =~ /\@example\.(com|org|net)$/i;
  # WhatsApp only: it has to be a mobile. The phone may be a landline.
  {
    (my $d = $c->{whatsapp} // '') =~ s/\D//g;
    $d =~ s/^91(?=\d{10}$)//;
    if ($d ne '' && $d !~ /^[6-9]\d{9}$/ && $d !~ /1234567890$/) {
      fail("contact.whatsapp '$c->{whatsapp}' is neither an Indian mobile nor the dummy");
    }
  }
  if (@dummy && !$shop->{placeholder}) {
    fail('placeholder is false but ' . join(', ', @dummy) . ' still hold the dummy '
       . 'contact details -- put the shop\'s real ones in first');
  } elsif (@dummy) {
    ok(join(', ', @dummy) . ' are dummies that reach nobody, allowed only while placeholder is true');
  }
}

my $upi = $shop->{upi} || {};
if ($upi->{demo}) {
  my ($handle) = ($upi->{vpa} // '') =~ /\@(.+)$/;
  $handle = lc($handle // '');
  # A demo id on a REAL handle could send a customer's money to whoever owns it.
  # ⚠️ An ALLOW-list since 7 November 2026, not the deny-list it was: the page
  # no longer tells anyone the QR is a demo (the owner's call, to show the flow
  # as it will be), so this is the whole guard, and a list of real handles is
  # never complete -- a new bank's handle would have walked straight past it.
  # `example` is reserved and resolves to nobody.
  if ($handle eq 'example') {
    ok("upi is a demo id on the unresolvable handle '\@example'");
  } else {
    fail("upi.demo is true but the handle is '\@$handle', not '\@example' -- "
       . "a demo id on any other handle could send a customer's money to whoever owns it, "
       . "and nothing on the page says the QR is a demo any more");
  }
  # And the shop cannot stop being a preview while its QR is a demo.
  if (!$shop->{placeholder}) {
    fail('placeholder is false but upi.demo is still true -- put the real UPI id in first');
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
