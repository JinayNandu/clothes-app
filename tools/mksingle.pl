#!/usr/bin/perl
# Build the ONE-FILE copy of the shop.
#
#   perl tools/mksingle.pl
#   -> build/devi-collections.html
#
# ---------------------------------------------------------------------------
# WHY
#
# The served app is 26 ES modules and 4 JSON files, which needs an http://
# origin: modules and fetch both refuse to run from a file:// path, and the
# app says so in its own boot error. That is correct for development and
# useless for "send the shop to my phone".
#
# This produces a single self-contained .html: every stylesheet, every
# module and the whole catalogue inside one file. It opens from a messaging
# app, a Files app, a USB stick or an email attachment, with no server and
# no network. It is also exactly what you upload to a static host -- rename
# it index.html, drop it in, and the URL is the shop.
#
# ---------------------------------------------------------------------------
# WHY A REAL BUNDLER AND NOT `cat app/*.js`
#
# Concatenation fails twice over.
#
#   1. ORDER. ui.js must exist before cart.js runs. Alphabetical order is
#      not dependency order, and guessing it by hand goes stale the first
#      time a module gains an import.
#   2. NAMES. `price`, `product`, `valid`, `variant`, `is` and `fmt` are each
#      declared at the top level of more than one module. In separate module
#      scopes that is fine and deliberate. Poured into one scope it is a
#      redeclaration error, or worse, silently the wrong function.
#
# So: walk the real import graph from app.js, sort it topologically, and give
# every module its own function scope -- which is what a module scope IS.
# Imports become reads from a registry filled in dependency order, so by the
# time a module body runs, everything it imports is already in there.
#
# ⚠️ This assumes the graph is ACYCLIC and dies loudly if it is not, because
# a cycle under this scheme hands you `undefined` at import time rather than
# the half-initialised namespace real ESM would give you. routes.pl already
# forbids the one cycle this project could plausibly grow (ui.js importing a
# page module), so the two checks guard the same property from both ends.
# ---------------------------------------------------------------------------
use strict;
use warnings;
use JSON::PP;   # core since 5.14 -- for the placeholder flag, see robots.txt below

my $root = $0; $root =~ s{[/\\]tools[/\\]mksingle\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";
my $OUT = "$root/build";
mkdir $OUT unless -d $OUT;

sub slurp {
  my ($p) = @_;
  open my $fh, '<:encoding(UTF-8)', $p or die "cannot read $p: $!\n";
  local $/; my $t = <$fh>; close $fh;
  return $t;
}

# ---------------------------------------------------------------------------
# Resolve a specifier against the importing module's directory.
#   ('pages/home.js', '../ui.js')  ->  'ui.js'
#   ('app.js',        './store.js') ->  'store.js'
# ---------------------------------------------------------------------------
sub resolve {
  my ($from, $spec) = @_;
  my @dir = split m{/}, $from;
  pop @dir;                             # drop the filename
  my @out = @dir;
  for my $part (split m{/}, $spec) {
    next if $part eq '.' || $part eq '';
    if ($part eq '..') { pop @out; next }
    push @out, $part;
  }
  return join('/', @out);
}

# ---------------------------------------------------------------------------
# Read one module: rewrite its imports, strip `export`, collect the names.
# ---------------------------------------------------------------------------
my (%MOD, %DEPS);

sub read_module {
  my ($key) = @_;
  return if exists $MOD{$key};

  my $src = slurp("$APP/$key");
  my (@deps, @names, @lines);

  # A destructured re-export, which spans lines and so cannot be seen by the
  # line loop below. This is store.js's entire job -- the nine-line facade --
  # so it is not an edge case, it is the seam the whole project turns on.
  #
  #   export const { ready, cart, ... } = backend;
  while ($src =~ s!^export\s+(const\s*\{([^}]*)\}\s*=\s*[^;]+;)!$1!ms) {
    my $list = $2;
    die "$key: aliased destructured export is not handled:\n  $list\n"
      if $list =~ /:/;
    push @names, $list =~ /([A-Za-z_\$][\w\$]*)/g;
  }

  # ---------------------------------------------------------------------------
  # PRE-PASS: fold a wrapped named import onto one line.
  #
  # The parser below is line-by-line, so a long import list broken across lines
  # reaches it as two fragments and it dies on the first:
  #
  #   import { renderCatalogue, renderInventory, renderCategories }
  #     from './admin-catalog.js';
  #
  # ⚠️ Fixed HERE rather than by reflowing the source to suit the tool. A rule
  # that says "imports must fit on one line" is a rule nobody remembers and
  # nothing enforces, and the failure only shows up at build time, long after
  # the edit. Same reasoning as the destructured-export pre-pass above.
  #
  # [^}] already spans newlines; /m is what makes ^ match at a line start.
  $src =~ s!^import\s+\{([^}]*)\}\s*from\s+(['"][^'"]+['"];?)!
            'import {' . join(' ', split(' ', $1)) . "} from $2"!mge;

  for my $line (split /\n/, $src, -1) {
    # import { a, b } from './x.js';
    # ⚠️ `!` delimiters, not `{}`: Perl counts unescaped braces to find the
    # end of a m{} pattern, so the `}` inside [^}] closes it early.
    if ($line =~ m!^import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\s*$!) {
      my ($what, $spec) = ($1, $2);
      my $dep = resolve($key, $spec);
      push @deps, $dep;
      push @lines, "const {$what} = __M['$dep'];";
      next;
    }
    # import * as X from './x.js';
    if ($line =~ m{^import\s+\*\s+as\s+([A-Za-z_\$][\w\$]*)\s+from\s+['"]([^'"]+)['"];?\s*$}) {
      my ($as, $spec) = ($1, $2);
      my $dep = resolve($key, $spec);
      push @deps, $dep;
      push @lines, "const $as = __M['$dep'];";
      next;
    }
    # import './pages/x.js';   -- a side-effect import, and the ONLY way a
    # page module ever gets registered. Topological order already guarantees
    # it has run, so the line becomes nothing at all.
    if ($line =~ m{^import\s+['"]([^'"]+)['"];?\s*$}) {
      push @deps, resolve($key, $1);
      push @lines, '';
      next;
    }
    # Anything else starting with `import` is a form this bundler has not
    # been taught. Dying beats emitting code that looks fine and is not.
    die "$key: unhandled import form:\n  $line\n" if $line =~ m{^import\b};

    # export [async ]function NAME / export const NAME / export class NAME
    if ($line =~ m{^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_\$][\w\$]*)}) {
      push @names, $1;
      $line =~ s{^export\s+}{};
      push @lines, $line;
      next;
    }
    die "$key: unhandled export form:\n  $line\n" if $line =~ m{^export\b};

    push @lines, $line;
  }

  $MOD{$key}  = { body => join("\n", @lines), names => \@names };
  $DEPS{$key} = \@deps;

  read_module($_) for @deps;
}

read_module('app.js');

# ---------------------------------------------------------------------------
# Topological sort -- post-order DFS, with a cycle check that names the loop.
# ---------------------------------------------------------------------------
my (@order, %state);
sub visit {
  my ($key, @stack) = @_;
  my $s = $state{$key} // 0;
  return if $s == 2;
  die "import cycle: " . join(' -> ', @stack, $key) . "\n" if $s == 1;
  $state{$key} = 1;
  visit($_, @stack, $key) for @{ $DEPS{$key} };
  $state{$key} = 2;
  push @order, $key;
}
visit('app.js');

# ---------------------------------------------------------------------------
# Emit the bundle.
# ---------------------------------------------------------------------------
my $js = <<'PRE';
/* ==========================================================================
   DEVI Collections -- single-file build.
   Generated by tools/mksingle.pl from app/. Do not edit this file: edit the
   real modules under app/ and run the script again.
   ========================================================================== */
(function () {
'use strict';

/* The module registry. Filled in dependency order, so a module body never
   reads a key that is not there yet. */
const __M = {};
PRE

# The four data files, which on a server would be four fetches.
$js .= "\n/* ---- data/, inlined: there is no server to fetch it from ---- */\n";
$js .= "const __DEVI_DATA = {};\n";
$js .= "globalThis.__DEVI_DATA = __DEVI_DATA;\n";
my @data = qw(catalog.json categories.json shop.json pages.json);
for my $d (@data) {
  my $json = slurp("$APP/data/$d");
  $json =~ s/\s+$//;
  $js .= "__DEVI_DATA['data/$d'] =\n$json;\n";
}

for my $key (@order) {
  my $m = $MOD{$key};
  my $ret = @{ $m->{names} }
    ? "return { " . join(', ', @{ $m->{names} }) . " };"
    : "return {};";
  $js .= "\n/* ================= $key ================= */\n";
  $js .= "__M['$key'] = (function () {\n";
  $js .= $m->{body};
  $js .= "\n$ret\n})();\n";
}
$js .= "\n})();\n";

# ---- the page ------------------------------------------------------------
my $html = slurp("$APP/index.html");

my @sheets;
push @sheets, $1 while $html =~ m{<link rel="stylesheet" href="styles/([^"]+)">}g;
die "no local stylesheets found\n" unless @sheets;
my $css = '';
$css .= "\n/* ===== styles/$_ ===== */\n" . slurp("$APP/styles/$_") for @sheets;

$html =~ s{(<link rel="stylesheet" href="styles/[^"]+">\s*)+}{<style>$css</style>\n}s;
$html =~ s{<script type="module" src="app\.js"></script>}{<script>\n$js</script>}s;

die "the module script tag was not replaced\n" if $html =~ m{src="app\.js"};
die "a stylesheet link survived\n"             if $html =~ m{href="styles/};

open my $fh, '>:encoding(UTF-8)', "$OUT/devi-collections.html" or die "cannot write: $!\n";
print $fh $html;
close $fh;

# The same bytes again as docs/index.html -- THE PUBLISH DIRECTORY.
#
# One folder serves both ways of putting this on the internet:
#   - GitHub Pages offers exactly two source folders, the repo root and
#     /docs. Root would mean the shop's index.html sitting on top of the
#     source tree, so /docs it is.
#   - Every drag-and-drop host (Netlify Drop, Cloudflare Pages, tiiny.host)
#     serves index.html as the root of whatever folder you drop on it.
#
# ⚠️ docs/ IS GENERATED and is committed anyway, because Pages serves what is
# in the branch and cannot run a build step. Never hand-edit it: run this
# script. It is written HERE, in the same pass, from the same string as the
# file above -- a hand-made copy of a generated file is exactly the drift
# this project keeps refusing to allow.
mkdir "$root/docs" unless -d "$root/docs";
open my $up, '>:encoding(UTF-8)', "$root/docs/index.html" or die "cannot write: $!\n";
print $up $html;
close $up;

# GitHub Pages runs everything through Jekyll unless told not to, and Jekyll
# silently drops files and folders whose names begin with an underscore. This
# site has none today, but the failure mode -- a file that is simply absent,
# with no error anywhere -- is expensive enough to pre-empt with an empty file.
open my $nj, '>', "$root/docs/.nojekyll" or die "cannot write: $!\n";
close $nj;

# ---------------------------------------------------------------------------
# robots.txt, DRIVEN BY THE SAME placeholder FLAG data.pl FAILS ON.
#
# A private link you send to one person and a public URL a search engine can
# index are different things, and the catalogue is not ready to be the second
# one: every price is invented and the UPI id collects no money. Having
# Google carry invented prices under a real brand's name is a harm the flag
# already exists to prevent, so it should govern this too -- automatically,
# rather than depending on someone remembering.
#
# Clear `placeholder` and the next build opens the site up. Nothing else to
# remember, and nothing to undo by hand.
# ---------------------------------------------------------------------------
my $shop = JSON::PP->new->decode(slurp("$APP/data/shop.json"));
my $hidden = $shop->{placeholder} ? 1 : 0;
open my $rb, '>:encoding(UTF-8)', "$root/docs/robots.txt" or die "cannot write: $!\n";
if ($hidden) {
  print $rb "# shop.json has \"placeholder\": true -- the prices and contact\n";
  print $rb "# details are not real yet, so this site must not be indexed.\n";
  print $rb "# Generated by tools/mksingle.pl. Clear the flag and rebuild.\n";
  print $rb "User-agent: *\nDisallow: /\n";
} else {
  print $rb "# Generated by tools/mksingle.pl.\n";
  print $rb "User-agent: *\nAllow: /\n";
}
close $rb;

# ---------------------------------------------------------------------------
# Guards. Each one is a way this build can be wrong while looking right.
# ---------------------------------------------------------------------------
my $fail = 0;
sub bad { print "FAIL  $_[0]\n"; $fail = 1 }

# 1. Nothing may still be fetched at runtime -- the point of the exercise.
for my $pat ('src="app.js"', 'href="styles/', q{fetch('data/}) {
  bad("the page still references $pat") if index($html, $pat) >= 0;
}

# 2. No import/export statement may survive. One that did would throw on
#    load, in a file the user has already sent to somebody.
my $n = 0;
for my $line (split /\n/, $js) {
  $n++ if $line =~ m!^\s*(?:import|export)\s+[\{\*'"a-zA-Z]!;
}
bad("$n import/export statement(s) survived the bundle") if $n;

# 3. Every module in the graph must be in the output, exactly once.
for my $key (sort keys %MOD) {
  my $c = () = $js =~ m{\Q__M['$key'] = (function\E}g;
  bad("$key emitted $c times, expected 1") unless $c == 1;
}

# 4. A module must appear AFTER everything it imports.
my %pos; $pos{ $order[$_] } = $_ for 0 .. $#order;
for my $key (keys %DEPS) {
  for my $d (@{ $DEPS{$key} }) {
    bad("$key comes before its import $d") if $pos{$d} > $pos{$key};
  }
}

my $kb = int((-s "$OUT/devi-collections.html") / 1024);
printf "built build/devi-collections.html  (%d KB, %d modules, %d stylesheets, %d data files)\n",
  $kb, scalar(@order), scalar(@sheets), scalar(@data);
exit 1 if $fail;
print "ok    self-contained: no script, style or data is fetched\n";
exit 0;
