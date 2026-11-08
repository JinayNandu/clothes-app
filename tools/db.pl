#!/usr/bin/perl
# The database and the app agree, and no secret is in the repository.
#
#   perl tools/db.pl
#
# ---------------------------------------------------------------------------
# db/schema.sql restates three things the app already knows, because SQL
# cannot read a JSON file or a JavaScript module: the order-code prefix, the
# list of statuses, and the road between them. Each pair can drift silently
# -- the database would number orders one way and the page another, or
# refuse a step the board offers -- so each is compared here.
#
# And it guards the edges that matter most on a public repository: every
# table locked down, every function revoked from everybody before its one
# grant, those grants exactly the functions the app calls, the store code
# never written into a file, and nothing in config.js that is not a
# PUBLISHABLE key.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(decode_base64);

my $root = $0; $root =~ s{[\x5C/]tools[\x5C/]db\.pl$}{};
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

my $sql  = slurp("$root/db/schema.sql");
my $code = slurp("$root/db/store-code.sql");
my $dom  = slurp("$APP/domain.js");
my $shop = JSON::PP->new->decode(slurp("$APP/data/shop.json"));
my $cfg  = slurp("$APP/config.js");
(my $sqlc = $sql) =~ s/--[^\n]*//g;          # SQL with its comments out

# ---------------------------------------------------------------------------
# 1. The order-code prefix: the initials of brand.name, exactly as
#    domain.js orderPrefix() makes them.
# ---------------------------------------------------------------------------
my $want = join '', map { my $w = $_; $w =~ s/[^A-Za-z]//g; length $w ? uc substr($w, 0, 1) : '' }
                    split /\s+/, ($shop->{brand}{name} // '');
$want = substr($want, 0, 3) || 'ORD';
if ($sqlc =~ /code\s+text\s+generated\s+always\s+as\s+\(\s*'([A-Z]+)-'/) {
  if ($1 eq $want) { ok("order codes are $want- in both the app and the database"); }
  else { fail("schema.sql mints $1- but shop.json's name makes $want- -- the two would number "
            . "the same shop's orders differently. See db/SETUP.md before changing a live table"); }
} else {
  fail('could not find the generated order code in schema.sql');
}

# ---------------------------------------------------------------------------
# 2. The statuses, and 3. the road between them.
# ---------------------------------------------------------------------------
my ($nb) = $dom =~ /export const ORDER_NEXT = \{(.*?)\n\};/s
  or die "could not find ORDER_NEXT in domain.js\n";
my (%next, @pairs);
while ($nb =~ /^\s*([a-z]+):\s*\[([^\]]*)\]/mg) {
  my ($from, $list) = ($1, $2);
  $next{$from} = 1;
  push @pairs, "$from>$_" for $list =~ /'([a-z]+)'/g;
}
my @server = sort grep { $_ ne 'draft' } keys %next;
my ($sl) = $sqlc =~ /status\s+text\s+not\s+null\s+default\s+'sent'\s+check\s*\(\s*status\s+in\s*\((.*?)\)\s*\)/s;
my @dbs = sort(($sl // '') =~ /'([a-z]+)'/g);
if ("@dbs" eq "@server") { ok(scalar(@dbs) . ' statuses, the same in domain.js and the database'); }
else { fail("statuses differ -- domain.js (less draft): @server; schema.sql: @dbs"); }

my @road = sort grep { !/^draft>/ } @pairs;
my ($tl) = $sqlc =~ /if\s*\(\s*cur\s*,\s*p_to\s*\)\s*not\s+in\s*\((.*?)\)\s*then/s;
my @dbr;
push @dbr, "$1>$2" while ($tl // '') =~ /\(\s*'([a-z]+)'\s*,\s*'([a-z]+)'\s*\)/g;
@dbr = sort @dbr;
if ("@dbr" eq "@road") { ok(scalar(@dbr) . ' steps between them, the same in domain.js and advance_order()'); }
else { fail("the road differs -- domain.js: @road; advance_order(): @dbr"); }

# ---------------------------------------------------------------------------
# 3b. Each ITEM's statuses and road (7 November 2026): LINE_NEXT in
#     domain.js, against the order_lines_status_ok check and advance_line().
# ---------------------------------------------------------------------------
my ($lnb) = $dom =~ /export const LINE_NEXT = \{(.*?)\n\};/s
  or die "could not find LINE_NEXT in domain.js\n";
my (%lnext, @lpairs);
while ($lnb =~ /^\s*([a-z]+):\s*\[([^\]]*)\]/mg) {
  my ($from, $list) = ($1, $2);
  $lnext{$from} = 1;
  push @lpairs, "$from>$_" for $list =~ /'([a-z]+)'/g;
}
my @lstat = sort keys %lnext;
my ($lsl) = $sqlc =~ /order_lines_status_ok\s+check\s*\(\s*status\s+in\s*\((.*?)\)\s*\)/s;
my @dbls = sort(($lsl // '') =~ /'([a-z]+)'/g);
if ("@dbls" eq "@lstat") { ok(scalar(@dbls) . ' item statuses, the same in domain.js and the database'); }
else { fail("item statuses differ -- domain.js LINE_NEXT: @lstat; order_lines_status_ok: @dbls"); }

my ($ltl) = $sqlc =~ /if\s*\(\s*lcur\s*,\s*p_to\s*\)\s*not\s+in\s*\((.*?)\)\s*then/s;
my @dblr;
push @dblr, "$1>$2" while ($ltl // '') =~ /\(\s*'([a-z]+)'\s*,\s*'([a-z]+)'\s*\)/g;
@dblr = sort @dblr;
my @lroad = sort @lpairs;
if (@dblr && "@dblr" eq "@lroad") { ok(scalar(@dblr) . ' item steps, the same in domain.js and advance_line()'); }
else { fail("an item's road differs -- domain.js LINE_NEXT: @lroad; advance_line(): @dblr"); }

# ---------------------------------------------------------------------------
# 3c. GOING BACK (8 November 2026): step_back_order() and step_back_line()
#     each carry the road they may walk back along. Both must be LINE_ROAD
#     in domain.js, which canStepBack() reads -- or the board would offer a
#     step back the server refuses, or the server allow one the page never
#     drew.
# ---------------------------------------------------------------------------
my ($lroad_js) = $dom =~ /export const LINE_ROAD = \[([^\]]*)\]/
  or die "could not find LINE_ROAD in domain.js\n";
my $want_back = join ' ', $lroad_js =~ /'([a-z]+)'/g;
for my $fn (qw(step_back_order step_back_line)) {
  my ($body) = $sqlc =~ /function\s+\Q$fn\E\s*\(.*?\$fn\$(.*?)\$fn\$/s;
  if (!defined $body) { fail("could not find $fn() in schema.sql"); next; }
  my ($arr) = $body =~ /road\s+text\[\]\s*:=\s*array\[([^\]]*)\]/;
  my $got = join ' ', (($arr // '') =~ /'([a-z]+)'/g);
  if ($got eq $want_back) { ok("$fn() walks back along LINE_ROAD: $got"); }
  else { fail("$fn() walks back along '$got' but domain.js LINE_ROAD is '$want_back'"); }
  fail("$fn() does not check is_staff() first") unless $body =~ /^\s*begin\s+if\s+not\s+is_staff\(\)/m
    || $body =~ /begin\s*\n\s*if\s+not\s+is_staff\(\)\s+then\s+raise\s+exception\s+'NOT_STAFF'/;
}

# ---------------------------------------------------------------------------
# 4. Every table locked down: row-level security on, and named in the revoke
#    that takes away whatever the project handed out by default.
# ---------------------------------------------------------------------------
my @tables = $sqlc =~ /create\s+table\s+if\s+not\s+exists\s+(\w+)/g;
my ($revoked) = $sqlc =~ /revoke\s+all\s+on\s+table\s+([^;]*?)\s+from/s;
my %rev = map { $_ => 1 } (($revoked // '') =~ /(\w+)/g);
my $tbad = 0;
for my $t (@tables) {
  unless ($sqlc =~ /alter\s+table\s+\Q$t\E\s+enable\s+row\s+level\s+security/) {
    $tbad++; fail("table $t has no row-level security -- every row would be open to every role granted it");
  }
  unless ($rev{$t}) { $tbad++; fail("table $t is not in the 'revoke all on table' list"); }
}
ok(scalar(@tables) . ' tables, each with row-level security and revoked before any grant') unless $tbad;

# Nothing granted to anon -- a customer has a session before they order --
# but what EVERYBODY may read of the reviews (8 November 2026): the schema,
# and the two functions a product page calls with no session. Each must be
# STABLE, and neither may so much as name a customer's column.
my %ANON_OK = map { $_ => 1 } ('usage on schema public',
  'execute on function product_reviews(text)', 'execute on function rating_summary()');
my @anon_bad;
while ($sqlc =~ /grant\s+([^;]*?)\s+to\s+([^;]*)/g) {
  my ($what, $who) = ($1, $2);
  next unless $who =~ /\banon\b/;
  (my $w = lc $what) =~ s/\s+/ /g;
  push @anon_bad, $w unless $ANON_OK{$w};
}
for my $fn (qw(product_reviews rating_summary)) {
  my ($head, $body) = $sqlc =~ /function\s+\Q$fn\E\s*\(([^)]*\).*?)\$fn\$(.*?)\$fn\$/s;
  if (!defined $body) { push @anon_bad, "$fn() is missing"; next; }
  push @anon_bad, "$fn() is not STABLE" unless $head =~ /\bstable\b/;
  push @anon_bad, "$fn() names a customer's column ($1)"
    if $body =~ /\b(user_id|cust_\w+|addr|pin|mobile|email|order_id|line_id)\b/;
}
if (@anon_bad) { fail("anon may reach more than the public reviews: $_") for @anon_bad; }
else { ok('anon reaches only the public reviews: product_reviews() and rating_summary(), both read-only and nameless'); }

# ---------------------------------------------------------------------------
# 5. Every function revoked from everybody, and every SECURITY DEFINER one
#    with its search_path pinned.
# ---------------------------------------------------------------------------
my $fbad = 0;
my @fns;
while ($sqlc =~ /create\s+or\s+replace\s+function\s+(\w+)\s*\(([^)]*)\)(.*?)\$fn\$/sg) {
  my ($name, $args, $head) = ($1, $2, $3);
  push @fns, $name;
  if ($head =~ /security\s+definer/ && $head !~ /set\s+search_path/) {
    $fbad++; fail("function $name is SECURITY DEFINER with no pinned search_path");
  }
  unless ($sqlc =~ /revoke\s+all\s+on\s+function\s+\Q$name\E\s*\([^)]*\)\s+from\s+public,\s*anon,\s*authenticated/) {
    $fbad++; fail("function $name is never revoked from public, anon and authenticated -- "
                . 'Postgres lets everybody run a new function');
  }
}
ok(scalar(@fns) . ' functions, each revoked from everybody before its grant') unless $fbad;

# ---------------------------------------------------------------------------
# 5b. ...and granted back to exactly what the app calls (8 November 2026).
#     A missing grant hides from everything else: the self-test runs with
#     the SQL editor's rights, which skip grants, and a probe from outside
#     with no session sees only what anon may do. Customers would find out
#     first -- every rating, every order refused. So the names the app hands
#     to rpc(), rpcOrGone() and publicRpc() are read from the app itself:
#     each must be granted to authenticated, a publicRpc() one to anon too
#     (a product page calls it with no session), and nothing else may be.
# ---------------------------------------------------------------------------
my %granted;   # function -> { role => 1 }
while ($sqlc =~ /grant\s+execute\s+on\s+function\s+(\w+)\s*\([^)]*\)\s+to\s+([^;]*)/g) {
  my ($fn, $who) = ($1, $2);
  $granted{$fn}{$_} = 1 for $who =~ /\b(anon|authenticated)\b/g;
}
my (%calls, %public);
for my $f (glob("$APP/*.js"), glob("$APP/pages/*.js")) {
  my $t = slurp($f);
  $t =~ s{/\*.*?\*/}{}gs;
  $t =~ s{^[ \t]*//[^\n]*}{}gm;
  $calls{$_}  = 1 for $t =~ /\b(?:rpc|rpcOrGone|publicRpc)\(\s*['"](\w+)['"]/g;
  $public{$_} = 1 for $t =~ /\bpublicRpc\(\s*['"](\w+)['"]/g;
}
my $gbad = 0;
for my $fn (sort keys %calls) {
  unless ($granted{$fn}{authenticated}) {
    $gbad++; fail("the app calls $fn() but schema.sql never grants it to authenticated -- "
                . 'the database would refuse it to every signed-in customer and the store');
  }
  if ($public{$fn} && !$granted{$fn}{anon}) {
    $gbad++; fail("a page with no session calls $fn() but schema.sql never grants it to anon -- "
                . 'visitors would get nothing back');
  }
}
for my $fn (sort keys %granted) {
  next if $calls{$fn};
  $gbad++; fail("$fn() is granted to " . join(' and ', sort keys %{ $granted{$fn} })
              . ' but nothing in the app calls it -- take the grant away, or call it');
}
fail('found no function the app calls -- has the way backend-supabase.js calls the database changed?')
  unless %calls;
ok(scalar(keys %calls) . ' functions the app calls, each granted to the role that calls it, and nothing more')
  unless $gbad || !%calls;

# ---------------------------------------------------------------------------
# 6. The store code is never in a file. store-code.sql must still say
#    CHANGE-ME: the real code is typed into the SQL editor, never here.
# ---------------------------------------------------------------------------
if ($code =~ /declare\s+code\s+text\s*:=\s*'([^']*)'/) {
  if ($1 eq 'CHANGE-ME') { ok('store-code.sql still holds CHANGE-ME, not a code'); }
  else { fail('db/store-code.sql holds a real store code -- this repository is public. '
            . 'Put CHANGE-ME back and set the code in the SQL editor only'); }
} else {
  fail('could not find the code := line in db/store-code.sql');
}
fail('store-code.sql no longer insists on 8 or more characters') unless $code =~ /\{8,24\}/;

# Nothing in the app that has any business with the code or its hash.
my @leak;
for my $f (glob("$APP/*.js"), glob("$APP/pages/*.js"), glob("$APP/*.html"), glob("$APP/data/*.json")) {
  my $t = slurp($f);
  # Comments out: config.js WARNS about the secret key by name, and a check
  # that read its own warnings would fail on them.
  $t =~ s{/\*.*?\*/}{}gs;
  $t =~ s{^[ \t]*//[^\n]*}{}gm;
  $t =~ s{<!--.*?-->}{}gs;
  (my $rel = $f) =~ s{^\Q$root\E/}{};
  push @leak, "$rel: a bcrypt hash"         if $t =~ /\$2[aby]\$\d\d\$/;
  push @leak, "$rel: names shop_secret"     if $t =~ /\bshop_secret\b|\bcode_hash\b/;
  push @leak, "$rel: a secret Supabase key" if $t =~ /\bsb_secret_|\bservice_role\b/;
}
if (@leak) { fail("the app carries what it must not: $_") for @leak; }
else { ok('no hash, secret table or secret key anywhere in app/'); }

# ---------------------------------------------------------------------------
# 7. config.js: both empty, or a real project URL and a PUBLISHABLE key.
# ---------------------------------------------------------------------------
my ($cu) = $cfg =~ /SUPABASE\s*=\s*\{[^}]*?\burl:\s*'([^']*)'/s;
my ($ck) = $cfg =~ /SUPABASE\s*=\s*\{[^}]*?\bkey:\s*'([^']*)'/s;
if (!defined $cu || !defined $ck) {
  fail('could not read SUPABASE.url and SUPABASE.key in config.js');
} elsif ($cu eq '' && $ck eq '') {
  ok('no database configured: the app runs in one browser');
} elsif ($cu eq '' || $ck eq '') {
  fail('SUPABASE has a url or a key but not both -- the app would stay in one-browser mode');
} else {
  fail("SUPABASE.url '$cu' is not https://<project>.supabase.co")
    unless $cu =~ m{^https://[a-z0-9]{20}\.supabase\.co$};
  my $okkey = $ck =~ /^sb_publishable_[A-Za-z0-9_-]+$/;
  if (!$okkey && $ck =~ /^eyJ[\w-]+\.([\w-]+)\.[\w-]+$/) {
    (my $p = $1) =~ tr{-_}{+/};
    $p .= '=' x ((4 - length($p) % 4) % 4);
    my $claims = eval { JSON::PP->new->decode(decode_base64($p)) } || {};
    $okkey = ($claims->{role} // '') eq 'anon';
  }
  if ($okkey) { ok('a project URL and a publishable key -- the one that belongs in a page'); }
  else { fail('SUPABASE.key is not a publishable key. NEVER put the secret key here: it ignores '
            . 'every rule in schema.sql. Rotate it in the dashboard if it was ever pasted'); }
}
fail('CDN.supabase is not pinned to an exact version')
  unless $cfg =~ m{supabase:\s*'https://cdn\.jsdelivr\.net/npm/\@supabase/supabase-js\@\d+\.\d+\.\d+/\+esm'};

# ---------------------------------------------------------------------------
# 8. Signing in stays an offer (step 7). place_order() must never ask for an
#    account, and nobody but its owner reads an address book -- not even the
#    store, which sees the address each ORDER went to and needs no more.
# ---------------------------------------------------------------------------
my ($po) = $sqlc =~ /function\s+place_order\s*\(.*?\$fn\$(.*?)\$fn\$/s;
if (!defined $po) { fail('could not find place_order() in schema.sql'); }
elsif ($po =~ /signed_in\s*\(/) {
  fail('place_order() asks for a signed-in account -- buying must never need one');
}
else { ok('place_order() takes a guest as readily as an account'); }

my ($ap) = $sqlc =~ /create\s+policy\s+addr_read\s+on\s+addresses\s+(.*?);/s;
if (!defined $ap) { fail('no read policy on addresses'); }
elsif ($ap =~ /is_staff/ || $ap !~ /using\s*\(\s*user_id\s*=\s*auth\.uid\(\)\s*\)/) {
  fail('an address book is readable by more than its owner');
}
else { ok('an address book is read by its owner only -- not even by the store'); }

# ---------------------------------------------------------------------------
# 9. db/reset.sql (8 November 2026) empties the shop to start again. It must
#    never touch the store code, never change a table, function or rule, and
#    keep its LATCH -- a date after which it refuses -- ahead of its first
#    delete, so an old copy pasted by mistake cannot empty a shop with real
#    customers in it.
# ---------------------------------------------------------------------------
if (-e "$root/db/reset.sql") {
  (my $rs = slurp("$root/db/reset.sql")) =~ s/--[^\n]*//g;
  my $rbad = 0;
  if ($rs =~ /\bshop_secret\b/) { $rbad++; fail('reset.sql touches shop_secret -- the store code must survive a reset'); }
  my @ddl = grep { !/^drop\s+table\s+if\s+exists\s+pg_temp\.reset_report$/ }
            map { (my $x = lc $_) =~ s/\s+/ /g; $x =~ s/^\s+|\s+$//g; $x }
            ($rs =~ /\b((?:drop|alter|truncate|create|grant|revoke)\b(?:\s+(?:table|function|policy|schema|sequence|role|if|exists|temp|or|replace))*\s+[\w.]+)/gi);
  @ddl = grep { !/^create temp table reset_report$/ } @ddl;
  if (@ddl) { $rbad++; fail('reset.sql changes the database itself, not only its rows: ' . join('; ', @ddl)); }
  my $latch = index($rs, "raise exception 'NOTHING DELETED");
  my $first = $rs =~ /\bdelete\s+from\b/i ? $-[0] : -1;
  if ($latch < 0 || $rs !~ /\(now\(\)\s+at\s+time\s+zone\s+'Asia\/Kolkata'\)::date\s*>\s*date\s*'\d{4}-\d\d-\d\d'\s*then\s+raise\s+exception\s+'NOTHING DELETED/) {
    $rbad++; fail('reset.sql has lost its LATCH -- an old copy could empty a live shop');
  } elsif ($first >= 0 && $first < $latch) {
    $rbad++; fail('reset.sql deletes something before its LATCH is checked');
  }
  # Which database it is in, before a single row goes: a dashboard link can
  # open the project used last, and Milan's has tables of the same names.
  my $fp = index($rs, "raise exception 'NOTHING DELETED: this is not the");
  my ($fpre) = $rs =~ /generation_expression\s+like\s+'%''([A-Z]+)-''%'/;
  if ($fp < 0 || !defined $fpre) {
    $rbad++; fail("reset.sql no longer checks that it is in this shop's database -- run in Milan's "
                . 'project by mistake, it would empty that one');
  } elsif ($fpre ne $want) {
    $rbad++; fail("reset.sql looks for order codes $fpre- but this shop mints $want-");
  } elsif ($first >= 0 && $first < $fp) {
    $rbad++; fail('reset.sql deletes something before it checks which database it is in');
  }
  ok("reset.sql keeps the store code, changes no table or rule, refuses after its latch date, "
     . "and refuses any database whose orders are not $want-") unless $rbad;
}

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all database checks passed\n";
exit 0;
