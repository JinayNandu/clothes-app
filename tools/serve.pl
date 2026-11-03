#!/usr/bin/perl
# Minimal static file server. Core modules only — this machine has no Node
# or Python, and both ES modules and service workers refuse to run over
# file://, so local testing needs a real http:// origin.
#
#   perl tools/serve.pl [port] [docroot]
use strict;
use warnings;
# Listens on BOTH loopback addresses -- 127.0.0.1 and ::1 -- and on
# nothing else. A dev server has no business on the LAN, so this is
# deliberately not a wildcard bind.
#
# Both are needed because Chrome on Windows resolves "localhost" to
# ::1 first. An IPv4-only server is reachable by curl and invisible to
# the browser, which looks exactly like the app being broken.
use IO::Socket::IP;
use IO::Select;
use File::Spec;

# A browser that gives up mid-response would otherwise kill this process
# with SIGPIPE on the first abandoned request.
$SIG{PIPE} = 'IGNORE';

# --lan opens the server to the local network so a phone on the same Wi-Fi
# can reach it. OFF unless asked for, and that default is the point -- see
# the bind note above. `perl tools/serve.pl --lan 8130 app`
my $lan = 0;
@ARGV = grep { $_ eq '--lan' ? (($lan = 1), 0) : 1 } @ARGV;

my $port = shift // 8099;
my $root = shift // 'app';
$root = File::Spec->canonpath(File::Spec->rel2abs($root));
$root = join('/', split(/\x5C/, $root, -1));   # \x5C is a backslash

my %MIME = (
  html => 'text/html; charset=utf-8',
  js   => 'text/javascript; charset=utf-8',
  mjs  => 'text/javascript; charset=utf-8',
  json => 'application/json; charset=utf-8',
  css  => 'text/css; charset=utf-8',
  svg  => 'image/svg+xml',
  png  => 'image/png',
  jpg  => 'image/jpeg',
  ico  => 'image/x-icon',
  txt  => 'text/plain; charset=utf-8',
  webmanifest => 'application/manifest+json',
);

# With --lan, ONE wildcard socket instead of the two loopback ones:
# 0.0.0.0 already covers every IPv4 interface including 127.0.0.1, so
# adding the loopback socket as well just fails with EADDRINUSE.
my @binds = $lan ? ('0.0.0.0') : ('127.0.0.1', '::1');
my @srv;
for my $addr (@binds) {
  my $s = IO::Socket::IP->new(
    LocalHost => $addr, LocalPort => $port,
    Proto => 'tcp', Listen => 64, ReuseAddr => 1,
  );
  push @srv, $s if $s;
}
die "listen $port: $!\n" unless @srv;
my $sel = IO::Select->new(@srv);
$| = 1;
# The address another device must type. Found by opening a UDP socket
# towards a public resolver and reading back which interface the routing
# table chose -- no packet is sent, and it beats parsing ipconfig output
# that is localised on some machines.
sub lan_ip {
  my $s = IO::Socket::IP->new(
    PeerAddr => '8.8.8.8', PeerPort => 53, Proto => 'udp'
  ) or return undef;
  my $ip = $s->sockhost;
  close $s;
  return ($ip && $ip !~ /^127\./) ? $ip : undef;
}

if ($lan) {
  my $ip = lan_ip();
  print "\n";
  print "  DEVI Collections -- shared on this network\n";
  print "  " . ('-' x 44) . "\n";
  printf "  On this computer   http://127.0.0.1:%d/\n", $port;
  if ($ip) {
    printf "  On your phone      http://%s:%d/\n", $ip, $port;
  } else {
    print  "  On your phone      no network address found -- are you on Wi-Fi?\n";
  }
  print "\n";
  print "  The phone must be on the SAME Wi-Fi, and this window must stay\n";
  print "  open. Nothing outside this network can reach it.\n";
  print "  " . ('-' x 44) . "\n\n";
  printf "serving %s\n", $root;
} else {
  printf "serving %s on http://127.0.0.1:%d/ (%d loopback socket%s)\n",
    $root, $port, scalar(@srv), (@srv == 1 ? '' : 's');
}

while (1) {
  my @ready = $sel->can_read or next;
  for my $lsn (@ready) {
  my $c = $lsn->accept or next;

  # Never let one bad client take the server down.
  eval {
    my $req = <$c>;
    die "empty\n" unless defined $req;
    while (my $h = <$c>) { last if $h =~ /^\r?\n$/ }

    my ($path) = $req =~ m{^(?:GET|HEAD)\s+(\S+)\s+HTTP};
    die "unsupported\n" unless defined $path && length $path;

    $path =~ s/\?.*$//;
    $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
    $path = '/index.html' if $path eq '/' || $path eq '';

    my @parts = grep { length && $_ ne '.' && $_ ne '..' } split m{/}, $path;
    my $file  = join('/', $root, @parts);

    if (index($file, $root) != 0 || !-f $file) {
      print $c "HTTP/1.1 404 Not Found\r\n"
             . "Content-Length: 9\r\nConnection: close\r\n\r\nNot found";
      print "404 $path\n";
    }
    else {
      my ($ext) = $file =~ /\.([A-Za-z0-9]+)$/;
      my $type  = $MIME{lc($ext // '')} // 'application/octet-stream';

      open my $fh, '<:raw', $file or die "open\n";
      local $/;
      my $body = <$fh>;
      close $fh;

      print $c "HTTP/1.1 200 OK\r\n"
             . "Content-Type: $type\r\n"
             . "Content-Length: " . length($body) . "\r\n"
             . "Service-Worker-Allowed: /\r\n"
             . "Cache-Control: no-store\r\n"
             . "Connection: close\r\n\r\n";
      print $c $body;
      print "200 $path (" . length($body) . ")\n";
    }
    1;
  };
  my $err = $@;
  print "dropped: $err" if $err && $err !~ /^(?:empty|unsupported)\n/;
  close $c;
  }
}
