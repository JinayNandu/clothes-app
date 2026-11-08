#!/usr/bin/perl
# The first catalogue, from app/data/catalog.json into db/schema.sql.
#
#   perl tools/seed.pl          check that schema.sql carries catalog.json
#   perl tools/seed.pl --write  write it there
#
# Since 8 November 2026 the products live in the database, where the store
# page adds them and changes their prices and stock. They have to get there
# the first time from somewhere, and the somewhere is the file data.pl
# already checks. So the end of schema.sql carries one INSERT of every
# product in catalog.json, between two marker lines this script owns, and it
# runs only into an EMPTY products table: once the store has the catalogue,
# running schema.sql again leaves every product exactly as the store left it.
#
# ⚠️ WRITTEN, NEVER TYPED. A hand edit between the markers is overwritten by
# the next --write, and the check (db.pl runs it) fails on any difference --
# so the first catalogue in the database is always the one data.pl passed.
use strict;
use warnings;
use JSON::PP;

my $root = $0; $root =~ s{[/\\]tools[/\\]seed\.pl$}{};
$root = '.' if $root eq $0;
my $write = grep { $_ eq '--write' } @ARGV;
my $quiet = grep { $_ eq '--quiet' } @ARGV;

sub slurp {
  my ($p) = @_;
  open my $fh, '<:raw:encoding(UTF-8)', $p or die "cannot read $p: $!\n";
  local $/; my $t = <$fh>; close $fh; return $t;
}

my $cl = JSON::PP->new->utf8(0)->decode(slurp("$root/app/data/catalog.json"));
my $J  = JSON::PP->new->utf8(0)->canonical(1);

my $q    = sub { my ($s) = @_; return 'null' unless defined $s; $s =~ s/'/''/g; "'$s'" };
my $json = sub { my $s = $J->encode($_[0] // []); $s =~ s/'/''/g; "'$s'::jsonb" };
my $int  = sub { my ($n) = @_; die "seed.pl: '$n' is not a whole number\n" unless ($n // '') =~ /^\d+$/; $n };

my @cols = qw(id slug name cat sub price mrp short_desc descr specs variants img skus
              badges tags size_chart kind ship_class popularity added_on list_order);
my ($n, @rows) = (0);
for my $p (@{ $cl->{products} }) {
  $n++;
  die "seed.pl: $p->{id} has no skus -- run data.pl\n" unless ref $p->{skus} eq 'HASH';
  die "seed.pl: $p->{id}: addedOn is not a date\n" unless ($p->{addedOn} // '') =~ /^\d{4}-\d\d-\d\d$/;
  push @rows, '  (' . join(', ',
    $q->($p->{id}), $q->($p->{slug}), $q->($p->{name}), $q->($p->{cat}), $q->($p->{sub}),
    $int->($p->{price}), $int->($p->{mrp}), $q->($p->{shortDesc} // ''), $q->($p->{desc} // ''),
    $json->($p->{specs} || []), $json->($p->{variants} || {}), $json->($p->{img} || []),
    $json->($p->{skus}), $json->($p->{badges} || []), $json->($p->{tags} || []),
    $q->($p->{sizeChart}), $q->($p->{kind} // 'goods'), $q->($p->{shipClass} // 'std'),
    $int->($p->{popularity} // 50), "date '$p->{addedOn}'", $n) . ')';
}

my $BEGIN = '-- seed.pl BEGIN -- written by tools/seed.pl from app/data/catalog.json; never edit by hand';
my $END   = '-- seed.pl END';
my $block = <<"SQL" . join(",\n", @rows) . "\n) as v(" . join(', ', @cols) . ")\nwhere not exists (select 1 from products);\n$END\n";
$BEGIN
--
-- THE FIRST CATALOGUE: $n products, into an EMPTY products table only.
-- Once the store has products, this inserts nothing, so the store's own
-- prices, stock and products survive every later run of this file.
insert into products (@{[ join(', ', @cols) ]})
select v.* from (values
SQL

my $path = "$root/db/schema.sql";
my $sql  = slurp($path);
my ($have) = $sql =~ /(\Q$BEGIN\E.*?\Q$END\E\n)/s;

if ($write) {
  if (defined $have) { $sql =~ s/\Q$have\E/$block/ }
  else {
    $sql =~ s/\n*\z/\n\n/;
    $sql .= "-- =====================================================================\n"
          . "--  THE FIRST CATALOGUE (8 November 2026). See tools/seed.pl.\n"
          . "-- =====================================================================\n"
          . $block;
  }
  open my $fh, '>:raw:encoding(UTF-8)', $path or die "cannot write $path: $!\n";
  print $fh $sql; close $fh;
  print "wrote $n products into db/schema.sql\n";
  exit 0;
}

if (!defined $have) {
  print "FAIL  db/schema.sql carries no first catalogue -- run perl tools/seed.pl --write\n";
  exit 1;
}
if ($have ne $block) {
  print "FAIL  db/schema.sql's first catalogue is not app/data/catalog.json -- run perl tools/seed.pl --write\n";
  exit 1;
}
print "ok    db/schema.sql carries catalog.json's $n products, into an empty table only\n" unless $quiet;
exit 0;
