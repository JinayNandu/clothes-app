#!/usr/bin/perl
# Unbalanced brackets and strings, per file, with a real line number.
#
#   perl tools/balance.pl
#
# It exists because a browser reports a syntax error at the END of a file,
# which tells you nothing about where the mistake is.
#
# ---------------------------------------------------------------------------
# ⚠️ THE HARD PART IS NEUTRALISING LITERALS, and the trap is deeper than it
# looks. kirana's version warns that a character class like /[&<>"]/g pairs its
# quote with the next string in the file. This codebase has a worse case:
#
#     `<img alt="${(p.name || '').replace(/"/g, '&quot;')}">`
#
# a regex literal containing a quote, inside a ${} hole, inside a template.
# A first version of this script walked template holes with its own small
# loop that handled nested strings but not nested regexes -- and reported
# art.js as having an unclosed brace 180 lines earlier. The file was fine.
#
# The fix is structural: ONE loop with a context stack, so template holes are
# ordinary code and every literal rule applies at every depth automatically.
# ---------------------------------------------------------------------------
use strict;
use warnings;

my $root = $0; $root =~ s{[/\\]tools[/\\]balance\.pl$}{};
$root = '.' if $root eq $0;
my $APP = "$root/app";

my $fails = 0;
sub fail { $fails++; print "FAIL  $_[0]\n"; }
sub ok   { print "ok    $_[0]\n"; }

my @FILES;
for my $dir ('', '/pages') {
  opendir my $dh, "$APP$dir" or next;
  push @FILES, map { "$dir/$_" } sort grep { /\.js$/ } readdir $dh;
  closedir $dh;
}

my %CLOSES = (')' => '(', ']' => '[', '}' => '{');
my $checked = 0;

for my $rel (@FILES) {
  open my $fh, '<:encoding(UTF-8)', "$APP$rel" or do {
    fail("cannot read app$rel"); next;
  };
  local $/; my $src = <$fh>; close $fh;
  $checked++;

  my @brackets;              # [char, line]
  # [kind, depth] where depth is the bracket-stack size at which this context
  # was opened. ⚠️ The depth is load-bearing: a ${ } hole contains ordinary
  # code with its OWN braces, so "the next }" does not end the hole. Without
  # the depth, an arrow function or an if-block inside a hole popped the
  # template early and every literal after it was read in the wrong mode.
  my @ctx = (['code', 0]);
  my ($line, $i, $n) = (1, 0, length $src);
  my $err = 0;

  while ($i < $n) {
    my $c  = substr($src, $i, 1);
    my $nx = $i + 1 < $n ? substr($src, $i + 1, 1) : '';

    # ---------------------------------------------------------------- template
    if ($ctx[-1][0] eq 'tpl') {
      if ($c eq "\n") { $line++; $i++; next; }
      if ($c eq '\\') { $i += 2; next; }
      if ($c eq '`')  { pop @ctx; $i++; next; }
      # A ${ } hole is ORDINARY CODE. Pushing it onto the same stacks is the
      # whole point: every literal rule below then applies inside it, at any
      # nesting depth, with no second implementation to get wrong.
      if ($c eq '$' && $nx eq '{') {
        push @brackets, ['{', $line];
        push @ctx, ['code', scalar(@brackets)];
        $i += 2; next;
      }
      $i++; next;
    }

    # -------------------------------------------------------------------- code
    if ($c eq "\n") { $line++; $i++; next; }

    if ($c eq '/' && $nx eq '/') {
      my $e = index($src, "\n", $i);
      $i = $e < 0 ? $n : $e;
      next;
    }
    if ($c eq '/' && $nx eq '*') {
      my $e = index($src, '*/', $i + 2);
      $e = $n - 2 if $e < 0;
      $line += () = substr($src, $i, $e - $i) =~ /\n/g;
      $i = $e + 2;
      next;
    }

    if ($c eq '`') { push @ctx, ['tpl', scalar(@brackets)]; $i++; next; }

    if ($c eq "'" || $c eq '"') {
      my $q = $c; my $start = $line; $i++;
      my $closed = 0;
      while ($i < $n) {
        my $d = substr($src, $i, 1);
        if ($d eq '\\') { $i += 2; next; }
        if ($d eq "\n") {
          fail("app$rel:$start an unterminated $q string");
          $err = 1; last;
        }
        if ($d eq $q) { $closed = 1; $i++; last; }
        $i++;
      }
      last if $err;
      next;
    }

    # A regex literal, told from division by what precedes it. Getting this
    # wrong is how a checker starts reporting phantom errors.
    if ($c eq '/') {
      my $before = substr($src, 0, $i);
      $before =~ s/\s+$//;
      my $last = length($before) ? substr($before, -1) : '';
      if ($last eq '' || $last =~ /[\(\[\{,;=:!&|?+\-*%~^<>]/
          || $before =~ /\b(?:return|typeof|case|in|of|new|delete|void)$/) {
        $i++;
        my $incls = 0;
        while ($i < $n) {
          my $d = substr($src, $i, 1);
          if ($d eq '\\') { $i += 2; next; }
          if    ($d eq '[')            { $incls = 1; }
          elsif ($d eq ']')            { $incls = 0; }
          elsif ($d eq '/' && !$incls) { $i++; last; }
          elsif ($d eq "\n")           { last; }
          $i++;
        }
        next;
      }
    }

    if ($c =~ /[\(\[\{]/) { push @brackets, [$c, $line]; $i++; next; }

    if ($c =~ /[\)\]\}]/) {
      if (!@brackets) {
        fail("app$rel:$line a closing $c with nothing open");
        $err = 1; last;
      }
      my $top = pop @brackets;
      if ($top->[0] ne $CLOSES{$c}) {
        fail("app$rel:$line a $c closes a $top->[0] opened on line $top->[1]");
        $err = 1; last;
      }
      # Closing the brace of a ${ } hole returns to the template.
      if ($c eq '}' && @ctx > 1 && $ctx[-1][0] eq 'code'
          && scalar(@brackets) == $ctx[-1][1] - 1) {
        pop @ctx;
      }
      $i++; next;
    }

    $i++;
  }

  next if $err;
  if (@brackets) {
    my $t = $brackets[0];
    fail("app$rel:$t->[1] a $t->[0] is never closed"
       . (@brackets > 1 ? ' (and ' . (@brackets - 1) . ' more open)' : ''));
  }
  if (@ctx > 1) {
    fail("app$rel: a template literal is never closed");
  }
}

ok("$checked modules balanced") unless $fails;

print "\n";
if ($fails) { print "$fails FAILED\n"; exit 1; }
print "all balance checks passed\n";
exit 0;
