#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP qw(decode_json);
use Cwd qw(realpath);
use Fcntl qw(O_NOFOLLOW O_RDONLY);
use File::Temp qw(tempfile);
use IO::Uncompress::Gunzip ();
use utf8 ();

my $MAX = 1024 * 1024 * 1024;
my $BLOCK = 512;
my $MAX_LAYERS = 256;
my $MAX_STATE = 262144;
my $MAX_HEADERS = 262144;
my $MAX_PAX = 65536;
my $MAX_PATH = 4096;
my $MAX_LAYER_EXPANDED = 2 * 1024 * 1024 * 1024;
my $MAX_EXPANDED = 3 * 1024 * 1024 * 1024;
my $MARKER = qr/ollama|11434/i;
my $PARSED_HEADERS = 0;
my $PROJECTOR_TEMP_ROOT;
my @PROJECTOR_TEMP_IDENTITY;
my $DIAGNOSTIC = 0;
my $COUNT_DIAGNOSTIC = 0; my @DIAGNOSTIC_LAYER_HEADERS; my @DIAGNOSTIC_LAYER_EXPANDED; my $DIAGNOSTIC_OUTER_HEADERS = 0; my $DIAGNOSTIC_EXPANDED_TOTAL = 0;
my $DIAGNOSTIC_REMOVE_SCANS = 0; my $DIAGNOSTIC_INDEX_VISITS = 0; my $INDEX_ENTRIES = 0;
my $PHASE = 'input';

sub phase { $PHASE = $_[0] }
sub diagnostic_summary { print STDERR 'image projection diagnostic headers=' . $DIAGNOSTIC_OUTER_HEADERS . ',' . join(',', @DIAGNOSTIC_LAYER_HEADERS) . ' expanded=' . join(',', @DIAGNOSTIC_LAYER_EXPANDED) . ' total=' . $PARSED_HEADERS . ' expanded-total=' . $DIAGNOSTIC_EXPANDED_TOTAL . ' scans=' . $DIAGNOSTIC_REMOVE_SCANS . ' index-visits=' . $DIAGNOSTIC_INDEX_VISITS . "\n" }
sub fail { if ($DIAGNOSTIC) { print STDERR "image projection refused phase=$PHASE\n"; diagnostic_summary() if $COUNT_DIAGNOSTIC } die "image projection refused\n" }
sub verdict { my ($value) = @_; print STDOUT $value or fail(); close STDOUT or fail(); exit 0 }
sub read_at {
  my ($fh, $offset, $size) = @_;
  sysseek($fh, $offset, 0) or fail();
  my $buf = '';
  while (length($buf) < $size) {
    my $read = sysread($fh, $buf, $size - length($buf), length($buf));
    fail() unless defined $read && $read;
  }
  return $buf;
}
sub raw_bytes { my ($value) = @_; utf8::encode($value) if utf8::is_utf8($value); return $value }
sub field {
  my ($bytes) = @_;
  my $end = index($bytes, "\0");
  my $used = $end < 0 ? $bytes : substr($bytes, 0, $end);
  if ($end >= 0 && substr($bytes, $end) =~ /[^\0 ]/) { fail() }
  return $used;
}
sub number { my $value = field($_[0]); $value =~ s/^\s+|\s+$//g; fail() unless $value =~ /^[0-7]+$/; return oct($value) }
sub path {
  my $value = raw_bytes($_[0]);
  fail() if length($value) > $MAX_PATH;
  $value =~ s/^\.\/// while $value =~ m!^\./!;
  $value =~ s!/+$!!;
  return '' unless length $value;
  fail() if $value =~ m!^/! || $value =~ m!//! || $value =~ /\\/ || $value =~ m!(^|/)(?:\.|\.\.?)(/|$)! || $value =~ /[\x00-\x1f\x7f]/;
  return $value;
}
sub link_path {
  my ($value, $entry_path) = @_; fail() unless defined $value; $value = raw_bytes($value);
  fail() if length($value) > $MAX_PATH || $value =~ m!//! || $value =~ /[\x00-\x1f\x7f\\]/;
  my @parts = $value =~ m!^/! ? () : split('/', $entry_path);
  pop @parts unless $value =~ m!^/!;
  for my $part (split('/', $value, -1)) {
    next if $part eq '' || $part eq '.';
    if ($part eq '..') { fail() unless @parts; pop @parts; next }
    fail() if $part =~ /[\x00-\x1f\x7f\\]/;
    push @parts, $part;
  }
  fail() unless @parts;
  return join('/', @parts);
}
sub hardlink_path { my $value = raw_bytes($_[0]); fail() if $value =~ m!^//!; $value =~ s!^/!!; return path($value) }
sub parse_tar {
  my ($fh, $start, $length, $kind) = @_; my $outer = $kind eq 'outer-tar'; phase($kind);
  my @entries; my %names; my %global; my %pending; my $offset = 0;
  while ($offset < $length) {
    fail() if $length - $offset < $BLOCK;
    my $header = read_at($fh, $start + $offset, $BLOCK);
    if ($header =~ /^\0{512}$/) {
      phase($outer ? 'outer-tar-terminator' : 'layer-tar-terminator'); fail() if $length - $offset < 2 * $BLOCK || read_at($fh, $start + $offset + $BLOCK, $BLOCK) ne "\0" x $BLOCK;
      phase($outer ? 'outer-tar-tail' : 'layer-tar-tail');
      for (my $tail = $offset + 2 * $BLOCK; $tail < $length; $tail += 65536) {
        my $size = $length - $tail < 65536 ? $length - $tail : 65536;
        fail() if read_at($fh, $start + $tail, $size) =~ /[^\0]/;
      }
      phase($outer ? 'outer-tar-return' : 'layer-tar-return'); return \@entries;
    }
    if (++$PARSED_HEADERS > $MAX_HEADERS || @entries >= $MAX_HEADERS) { phase($outer ? 'outer-header-limit' : 'layer-header-limit'); fail() }
    phase($outer ? 'outer-entry' : 'layer-entry');
    my $checksum = substr($header, 148, 8); my $checksum_digits; if ($checksum =~ /^([0-7]{6})\0 $/ || $checksum =~ /^([0-7]{6}) \0$/ || $checksum =~ /^([0-7]{7})[\0 ]$/) { $checksum_digits = $1 } else { fail() }
    my $sum = 0; for my $index (0 .. 511) { $sum += $index >= 148 && $index < 156 ? 32 : ord(substr($header, $index, 1)) }
    fail() unless $sum == oct($checksum_digits);
    my $name = field(substr($header, 0, 100)); my $prefix = field(substr($header, 345, 155));
    my $type_byte = ord(substr($header, 156, 1)); my $type = $type_byte ? chr($type_byte) : '0';
    my $size = number(substr($header, 124, 12)); my $link = field(substr($header, 157, 100));
    my $data = $offset + $BLOCK; my $padded = int(($size + $BLOCK - 1) / $BLOCK) * $BLOCK;
    fail() if $data + $padded > $length;
    my $padding = $padded - $size ? read_at($fh, $start + $data + $size, $padded - $size) : '';
    fail() if $padding =~ /[^\0]/;
    if ($type eq 'x' || $type eq 'g' || $type eq 'L' || $type eq 'K') {
      phase($outer ? 'outer-extension' : 'layer-extension');
      fail() if $size > $MAX_PAX;
      my $payload = $size ? read_at($fh, $start + $data, $size) : '';
      if ($type eq 'L' || $type eq 'K') {
        $payload =~ s/\0+$//; fail() unless length($payload) && length($payload) <= $MAX_PATH && $payload !~ /[\x00-\x1f\x7f]/;
        $pending{$type eq 'L' ? 'path' : 'linkpath'} = $payload;
      } else {
        my %values; my $cursor = 0;
        while ($cursor < length($payload)) {
          my $line_end = index($payload, "\n", $cursor); fail() if $line_end < 0;
          my $line = substr($payload, $cursor, $line_end - $cursor + 1); fail() unless $line =~ /^(\d+) ([A-Za-z0-9._-]+)=(.*)\n$/s;
          my ($declared, $key, $value) = ($1, $2, $3); fail() unless $declared == length($line) && $value !~ /[\x00-\x1f\x7f]/;
          $values{$key} = $value; $cursor = $line_end + 1;
        }
        my %merged = $type eq 'g' ? (%global, %values) : (%global, %pending, %values);
        fail() if keys(%merged) > 256;
        my $metadata_bytes = 0; $metadata_bytes += length($_) + length($merged{$_}) for keys %merged;
        fail() if $metadata_bytes > $MAX_PAX;
        if ($type eq 'g') { %global = %merged } else { %pending = %merged }
      }
      $offset = $data + $padded; next;
    }
    phase($outer ? 'outer-type' : 'layer-type'); fail() unless $type =~ /^[0-6]$/;
    my %meta = (%global, %pending); %pending = (); my $metadata_match = !$outer && grep { $_ =~ $MARKER || $meta{$_} =~ $MARKER } keys %meta; my $path_override = exists $meta{path}; $name = $meta{path} if $path_override; $link = $meta{linkpath} if exists $meta{linkpath};
    phase($outer ? 'outer-path' : 'layer-path-syntax');
    my $raw_member_path = $path_override ? $name : length($prefix) ? "$prefix/$name" : $name; my $member_path = path($raw_member_path); fail() if !length($member_path) && $type ne '5';
    phase($outer ? 'outer-link' : 'layer-link');
    fail() if ($type eq '1' || $type eq '2') && !length($link);
    fail() if $type ne '0' && $size;
    phase($outer ? 'outer-path-duplicate' : 'layer-path-duplicate');
    if (exists $names{$member_path}) {
      if ($outer) { phase('outer-path-duplicate'); fail() }
      if ($raw_member_path ne $member_path || $names{$member_path}{raw} ne $raw_member_path) { phase('layer-path-duplicate-alias') }
      else { phase($type eq '5' && $names{$member_path}{type} eq '5' ? 'layer-path-duplicate-dir' : $type eq '0' && $names{$member_path}{type} eq '0' ? 'layer-path-duplicate-regular' : 'layer-path-duplicate-conflict') }
      fail() unless $type eq '5' && $names{$member_path}{type} eq '5' || $type eq '0' && $names{$member_path}{type} eq '0';
    }
    $names{$member_path} = { raw => $raw_member_path, type => $type };
    push @entries, { path => $member_path, start => $start + $data, size => $size, type => $type, link => $link, metadata_match => $metadata_match };
    $offset = $data + $padded;
  }
  phase($outer ? 'outer-tar-end' : 'layer-tar-end'); fail();
}
sub marker_bytes {
  my ($fh, $start, $size) = @_; my $carry = '';
  for (my $offset = 0; $offset < $size; $offset += 65536) {
    my $chunk = read_at($fh, $start + $offset, $size - $offset < 65536 ? $size - $offset : 65536);
    my $value = $carry . $chunk; return 1 if $value =~ $MARKER; $carry = substr($value, -7);
  }
  return 0;
}
sub projector_temp_root {
  my $root = $PROJECTOR_TEMP_ROOT;
  $root = '/tmp' unless defined $root && length $root;
  fail() unless $root =~ m!^/[^\0]*$! && -d $root && !-l $root;
  my $canonical = realpath($root); fail() unless defined $canonical && -d $canonical && !-l $canonical;
  @PROJECTOR_TEMP_IDENTITY = stat($canonical); fail() unless @PROJECTOR_TEMP_IDENTITY && $PROJECTOR_TEMP_IDENTITY[4] == $> && ($PROJECTOR_TEMP_IDENTITY[2] & 07777) == 0700;
  return $canonical;
}
sub same_identity {
  my ($left, $right) = @_;
  return @$left && @$right && $left->[0] == $right->[0] && $left->[1] == $right->[1] && $left->[2] == $right->[2] && $left->[4] == $right->[4] && $left->[3] == $right->[3];
}
sub same_location {
  my ($left, $right) = @_;
  return @$left && @$right && $left->[0] == $right->[0] && $left->[1] == $right->[1] && $left->[2] == $right->[2] && $left->[4] == $right->[4];
}
sub secure_tempfile {
  phase('scratch'); my $root = projector_temp_root();
  my ($out, $path) = tempfile('baci-ollama-layer-XXXXXX', DIR => $root, UNLINK => 1);
  my @after = stat($root); my $canonical_after = realpath($root); fail() unless same_location(\@PROJECTOR_TEMP_IDENTITY, \@after) && defined $canonical_after && $canonical_after eq $root;
  my @file = stat($out); fail() unless @file && ($file[2] & 0170000) == 0100000 && $file[4] == $> && ($file[2] & 07777) == 0600 && $file[3] == 1; unlink($path) or fail();
  return ($out, $path);
}
sub inflate_layer {
  my ($fh, $layer) = @_;
  fail() unless read_at($fh, $layer->{start}, 2) eq "\x1f\x8b";
  my ($out, $path) = secure_tempfile();
  binmode $out;
  phase('layer-gzip');
  seek($fh, $layer->{start}, 0) or fail();
  phase('layer-gzip-construct'); my $z = IO::Uncompress::Gunzip->new(
    $fh,
    InputLength => $layer->{size},
    MultiStream => 0,
    Strict => 1,
    BlockSize => 65536,
  );
  fail() unless $z;
  my $expanded = 0;
  phase('layer-gzip-read');
  while (1) {
    my $count = $z->read(my $chunk, 65536);
    fail() unless defined $count;
    fail() if $count < 0;
    last unless $count;
    $expanded += $count;
    phase('layer-gzip-limit'); fail() if $expanded > $MAX_LAYER_EXPANDED;
    my $offset = 0;
    while ($offset < $count) {
      my $written = syswrite($out, $chunk, $count - $offset, $offset);
      fail() unless defined $written && $written > 0;
      $offset += $written;
    }
  }
  phase('layer-gzip-trailing'); my $trailing = $z->trailingData();
  fail() if length $trailing;
  phase('layer-gzip-close'); fail() unless $z->close();
  sysseek($out, 0, 0) or fail();
  return { fh => $out, start => 0, size => $expanded, path => $path, compressed => $layer->{size} };
}
sub parent_path { my ($path) = @_; my $parent = $path; $parent =~ s!/[^/]+$!!; return $parent eq $path ? '' : $parent }
sub mark_prefixes { my ($prefixes, $tree, $path) = @_; my $parent = ''; for my $part (split('/', $path)) { my $current = length($parent) ? "$parent/$part" : $part; if (!exists $tree->{$parent}{$current}) { $tree->{$parent}{$current} = 1; $INDEX_ENTRIES++ } if (!exists $prefixes->{$parent}) { $prefixes->{$parent} = 1; $INDEX_ENTRIES++ } $DIAGNOSTIC_INDEX_VISITS++ if $COUNT_DIAGNOSTIC; $parent = $current } fail() if $INDEX_ENTRIES > $MAX_STATE }
sub remove_descendants { my ($state, $tree, $target) = @_; my $children = delete($tree->{$target}) // {}; $INDEX_ENTRIES -= scalar keys %$children; my @pending = keys %$children; while (@pending) { my $candidate = pop @pending; $DIAGNOSTIC_REMOVE_SCANS++ if $COUNT_DIAGNOSTIC; my $descendants = delete($tree->{$candidate}) // {}; $INDEX_ENTRIES -= scalar keys %$descendants; push @pending, keys %$descendants; delete $state->{$candidate}; my $parent = parent_path($candidate); $INDEX_ENTRIES-- if delete $tree->{$parent}{$candidate}; delete $tree->{$parent} unless keys %{$tree->{$parent} // {}} } }
sub remove_path { my ($state, $prefixes, $tree, $target, $children) = @_; delete $state->{$target}; remove_descendants($state, $tree, $target) if $children && (!length($target) || $prefixes->{$target}); my $parent = parent_path($target); $INDEX_ENTRIES-- if delete $tree->{$parent}{$target}; delete $tree->{$parent} unless keys %{$tree->{$parent} // {}} }
sub remove_children { my ($state, $prefixes, $tree, $target) = @_; return if length($target) && !$prefixes->{$target}; remove_descendants($state, $tree, $target) }
sub whiteout {
  phase('layer-whiteout-validate'); my ($entry) = @_; my $base = $entry->{path}; $base =~ s!^.*/!!; return undef unless index($base, '.wh.') == 0;
  my $parent = $entry->{path}; $parent =~ s!/[^/]+$!!; $parent = '' if $parent eq $entry->{path};
  return { kind => 'legacy' } if $base =~ /^\.wh\.\.wh\.(?:aufs|orph|plnk)$/ && (!$entry->{size}) && ($entry->{type} eq '0' || $entry->{type} eq '5');
  fail() unless $entry->{type} eq '0' && !$entry->{size};
  return { kind => 'opaque', parent => $parent } if $base eq '.wh..wh..opq';
  my $target = substr($base, 4); fail() unless length($target) && index($target, '.wh.') != 0;
  return { kind => 'path', path => length($parent) ? "$parent/$target" : $target };
}
sub apply_layer {
  my ($fh, $layer, $state, $prefixes, $tree) = @_;
  my $source = read_at($fh, $layer->{start}, 2) eq "\x1f\x8b" ? inflate_layer($fh, $layer) : { fh => $fh, start => $layer->{start}, size => $layer->{size}, compressed => $layer->{size} };
  phase('layer-tar'); my $entries = parse_tar($source->{fh}, $source->{start}, $source->{size}, 'layer-tar');
  phase('layer-whiteout-map'); my @whiteouts = map { [$_, whiteout($_)] } @$entries;
  phase('layer-whiteout-apply'); for my $item (@whiteouts) {
    my $value = $item->[1]; next unless $value;
    if ($value->{kind} eq 'opaque') { remove_children($state, $prefixes, $tree, $value->{parent}) }
    elsif ($value->{kind} eq 'path') { remove_path($state, $prefixes, $tree, $value->{path}, 1) }
  }
  my (@pending_hardlinks, %pending_by_target);
  my $settle_hardlinks = sub { my ($target_path) = @_; my @queue = ($target_path); while (@queue) { my $resolved_path = shift @queue; my $target = $state->{$resolved_path}; next unless $target && $target->{type} eq '0' && !$target->{pending}; for my $pending (@{delete($pending_by_target{$resolved_path}) // []}) { my ($path_name, $entry) = @$pending; next unless $state->{$path_name} && $state->{$path_name} == $entry; $entry->{direct} ||= $target->{direct}; delete $entry->{pending}; $entry->{type} = '0'; delete $entry->{link}; push @queue, $path_name } } };
  for my $item (@whiteouts) {
    my ($entry, $value) = @$item; next if $value;
    my $directory = $entry->{type} eq '5'; remove_path($state, $prefixes, $tree, $entry->{path}, !$directory);
    phase('layer-whiteout'); my $direct = $entry->{path} =~ $MARKER || $entry->{metadata_match} ? 1 : 0;
    if ($entry->{type} eq '0') { phase($COUNT_DIAGNOSTIC ? 'layer-marker-skip' : 'layer-marker-read'); $direct ||= marker_bytes($source->{fh}, $entry->{start}, $entry->{size}) unless $COUNT_DIAGNOSTIC }
    my $link = $entry->{link};
    if ($entry->{type} eq '1') {
      phase('layer-hardlink');
      $link = hardlink_path($link); my $target = $state->{$link}; if ($target && $target->{type} eq '0' && !$target->{pending}) { $direct ||= $target->{direct}; mark_prefixes($prefixes, $tree, $entry->{path}); $state->{$entry->{path}} = { direct => $direct, type => '0', link => undef }; $settle_hardlinks->($entry->{path}); fail() if keys(%$state) > $MAX_STATE; next }
      fail() if $target && !($target->{type} eq '1' && $target->{pending}); my $pending = { direct => $direct, type => '1', link => $link, pending => 1 }; mark_prefixes($prefixes, $tree, $entry->{path}); $state->{$entry->{path}} = $pending; my $pending_record = [$entry->{path}, $pending]; push @pending_hardlinks, $pending_record; push @{$pending_by_target{$link}}, $pending_record;
      fail() if keys(%$state) > $MAX_STATE; next;
    }
    if ($entry->{type} eq '2') { phase('layer-symlink'); $direct ||= $link =~ $MARKER; $link = link_path($link, $entry->{path}) }
    mark_prefixes($prefixes, $tree, $entry->{path}); $state->{$entry->{path}} = { direct => $direct, type => $entry->{type}, link => undef }; $settle_hardlinks->($entry->{path}) if $entry->{type} eq '0';
    fail() if keys(%$state) > $MAX_STATE;
  }
  phase('layer-hardlink-resolve'); for my $pending (@pending_hardlinks) { my ($path_name, $entry) = @$pending; next unless $state->{$path_name} && $state->{$path_name} == $entry; fail() if $entry->{pending}; }
  phase('layer-state-return'); return (scalar @$entries, $source->{size});
}
sub resolved {
  phase('layer-resolve'); my ($path_name, $state) = @_; my $entry = $state->{$path_name}; fail() unless $entry;
  return $entry->{direct} ? 1 : 0;
}

fail() unless @ARGV == 1 || @ARGV == 2 || @ARGV == 3;
$PROJECTOR_TEMP_ROOT = $ARGV[1] if @ARGV >= 2 && length $ARGV[1];
fail() unless @ARGV != 3 || $ARGV[2] eq '--diagnostic' || $ARGV[2] eq '--diagnostic-counts';
$DIAGNOSTIC = 1 if @ARGV == 3;
if (@ARGV == 3 && $ARGV[2] eq '--diagnostic-counts') { $COUNT_DIAGNOSTIC = 1; $MAX_HEADERS = $MAX_STATE }
if ($DIAGNOSTIC && defined $ENV{RETIRE_OLLAMA_IMAGE_MAX_HEADERS}) { fail() unless $ENV{RETIRE_OLLAMA_IMAGE_MAX_HEADERS} =~ /^[0-9]+$/ && $ENV{RETIRE_OLLAMA_IMAGE_MAX_HEADERS} > 0 && $ENV{RETIRE_OLLAMA_IMAGE_MAX_HEADERS} <= $MAX_STATE; $MAX_HEADERS = $ENV{RETIRE_OLLAMA_IMAGE_MAX_HEADERS} }
if (defined $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES}) {
  fail() unless $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} =~ /^[0-9]+$/ && $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} > 0;
  $MAX_LAYER_EXPANDED = $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} < $MAX_LAYER_EXPANDED ? $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} : $MAX_LAYER_EXPANDED;
  $MAX_EXPANDED = $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} < $MAX_EXPANDED ? $ENV{RETIRE_OLLAMA_IMAGE_MAX_EXPANDED_BYTES} : $MAX_EXPANDED;
}
phase('archive-open'); my @before = lstat($ARGV[0]); fail() unless @before && ($before[2] & 0170000) == 0100000 && $before[4] == $> && ($before[2] & 07777) == 0600 && $before[3] == 1;
sysopen my $fh, $ARGV[0], O_RDONLY | O_NOFOLLOW or fail(); binmode $fh;
my @opened = stat($fh); my @after = lstat($ARGV[0]); fail() unless same_identity(\@before, \@opened) && same_identity(\@opened, \@after);
my $size = -s $fh;
fail() unless defined $size && $size >= 2 * $BLOCK && $size <= $MAX;
my $headers_before_outer = $PARSED_HEADERS; my $outer = parse_tar($fh, 0, $size, 'outer-tar'); $DIAGNOSTIC_OUTER_HEADERS = $PARSED_HEADERS - $headers_before_outer; phase('manifest'); my ($manifest) = grep { $_->{path} eq 'manifest.json' } @$outer;
fail() unless $manifest && $manifest->{type} eq '0' && $manifest->{size} <= 1024 * 1024;
my $decoded = eval { decode_json(read_at($fh, $manifest->{start}, $manifest->{size})) }; fail() if $@ || ref($decoded) ne 'ARRAY' || @$decoded != 1; fail() unless ref($decoded->[0]) eq 'HASH';
my $layers = $decoded->[0]{Layers}; fail() unless ref($layers) eq 'ARRAY' && @$layers && @$layers <= $MAX_LAYERS;
my %outer = map { $_->{path} => $_ } @$outer; my %seen; my %state; my %tree;
my $layer_bytes = 0; my $expanded_bytes = 0; my $layer_entries = 0; my %prefixes;
for my $layer_path (@$layers) {
  phase('layer-select');
  fail() unless defined $layer_path && !ref($layer_path); my $canonical = path($layer_path); fail() if length($canonical) > $MAX_PATH;
  fail() unless length($canonical) && !$seen{$canonical}++; my $layer = $outer{$canonical};
  fail() unless $layer && $layer->{type} eq '0'; $layer_bytes += $layer->{size}; phase('layer-compressed-limit'); fail() if $layer_bytes > $MAX;
  my $headers_before_layer = $PARSED_HEADERS; my ($entries, $expanded) = apply_layer($fh, $layer, \%state, \%prefixes, \%tree); push @DIAGNOSTIC_LAYER_HEADERS, $PARSED_HEADERS - $headers_before_layer if $COUNT_DIAGNOSTIC; push @DIAGNOSTIC_LAYER_EXPANDED, $expanded if $COUNT_DIAGNOSTIC; $layer_entries += $entries; phase('layer-count-limit'); fail() if $layer_entries > $MAX_STATE;
  $expanded_bytes += $expanded; $DIAGNOSTIC_EXPANDED_TOTAL = $expanded_bytes if $COUNT_DIAGNOSTIC; phase('layer-cumulative-limit'); fail() if !$COUNT_DIAGNOSTIC && $expanded_bytes > $MAX_EXPANDED;
}
if ($COUNT_DIAGNOSTIC) { diagnostic_summary(); verdict("0\n") }
phase('layer-resolve');
for my $path_name (keys %state) {
  next unless resolved($path_name, \%state);
  verdict("1\n");
} verdict("0\n");
