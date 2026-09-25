#!/bin/sh
# Parse a Docker export tar and inspect only decoded member paths, link targets,
# and regular-file payloads. Grepping the raw archive would mistake octal
# header fields (for example 11434, the encoding of a 4892-byte file) for a
# live marker.
running_container_archive_matches() {
  running_archive_path=$1
  [ -f "$running_archive_path" ] && [ ! -L "$running_archive_path" ] || return 2
  /usr/bin/perl -e '
    use strict; use warnings; use Fcntl qw(O_RDONLY O_NOFOLLOW);
    my ($path) = @ARGV; sysopen(my $fh, $path, O_RDONLY | O_NOFOLLOW) or exit 2; binmode $fh;
    my $size = -s $fh; defined($size) && $size >= 1024 && $size % 512 == 0 or exit 2;
    my $marker = qr/ollama|11434/i; my $offset = 0; my %seen; my $found = 0; my $pax;
    sub read_exact { my ($fh, $want) = @_; my $value = q{}; while (length($value) < $want) { my $n = sysread($fh, my $chunk, $want - length($value)); defined($n) && $n or return; $value .= $chunk } return $value }
    sub field { my ($bytes) = @_; my $end = index($bytes, "\0"); my $used = $end < 0 ? $bytes : substr($bytes, 0, $end); return unless $end < 0 || substr($bytes, $end) !~ /[^\0 ]/; return $used }
    sub octal { my ($bytes) = @_; my $value = field($bytes); return unless defined $value; $value =~ s/^\s+|\s+$//g; return unless $value =~ /^[0-7]+$/; return oct($value) }
    sub safe_path { my ($value) = @_; return unless defined $value && length($value) && length($value) <= 4096; $value =~ s/^\.\///; return unless $value !~ m!^/|//|\\|\0|(^|/)\.\.?(/|$)!; return $value }
    sub parse_pax { my ($bytes) = @_; length($bytes) <= 65536 or return; my %values; my $records = 0; while (length $bytes) { $bytes =~ /\A([1-9][0-9]*) / or return; my $length = 0 + $1; $length <= length($bytes) && $length <= 8192 or return; my $record = substr($bytes, 0, $length, q{}); length($record) == $length && $record =~ /\A[0-9]+ ([A-Za-z][A-Za-z0-9._-]*)=([^\0\r\n]*)\n\z/s or return; my ($key, $value) = ($1, $2); ++$records <= 64 or return; exists($values{$key}) and return; $values{$key} = $value } return \%values }
    while ($offset + 512 <= $size) {
      defined(sysseek($fh, $offset, 0)) or exit 2; my $header = read_exact($fh, 512); defined $header or exit 2;
      if ($header eq "\0" x 512) {
        my $zero_blocks = 1;
        $offset += 512;
        while ($offset < $size) {
          my $tail = read_exact($fh, 512); defined $tail && $tail eq "\0" x 512 or exit 2;
          $zero_blocks += 1; $offset += 512;
        }
        $zero_blocks >= 2 or exit 2; last;
      }
      my $sum_field = substr($header, 148, 8); my ($digits) = $sum_field =~ /^(?:([0-7]{6})\0 |([0-7]{6}) \0|([0-7]{7})[\0 ])$/; $digits = $1 // $2 // $3; defined $digits or exit 2;
      my $sum = 0; for my $i (0 .. 511) { $sum += $i >= 148 && $i < 156 ? 32 : ord(substr($header, $i, 1)) } $sum == oct($digits) or exit 2;
      my $name = field(substr($header, 0, 100)); my $prefix = field(substr($header, 345, 155)); defined($name) && defined($prefix) or exit 2;
      my $type = substr($header, 156, 1); $type = "0" if $type eq "\0"; $type =~ /^(?:[0-6]|x)$/ or exit 2;
      my $member_size = octal(substr($header, 124, 12)); defined($member_size) && $member_size <= 4294967296 or exit 2;
      my $link = field(substr($header, 157, 100)); defined $link or exit 2;
      my $data = $offset + 512; my $padded = int(($member_size + 511) / 512) * 512; $data + $padded <= $size or exit 2;
      if ($type eq "x") {
        !$pax && $member_size > 0 && $member_size <= 65536 or exit 2;
        defined(sysseek($fh, $data, 0)) or exit 2; my $bytes = read_exact($fh, $member_size); defined $bytes or exit 2;
        $pax = parse_pax($bytes); defined $pax or exit 2; $offset = $data + $padded; next;
      }
      $type =~ /^[0-6]$/ or exit 2; $type eq "0" || $member_size == 0 or exit 2;
      my $member = safe_path($pax && exists($pax->{path}) ? $pax->{path} : length($prefix) ? "$prefix/$name" : $name); defined $member or exit 2;
      my $pax_match = $pax && grep { $_ =~ $marker || $pax->{$_} =~ $marker } keys %$pax; $link = $pax->{linkpath} if $pax && exists $pax->{linkpath}; $pax = undef;
      exists $seen{$member} && exit 2; $seen{$member} = 1;
      $found = 1 if $member =~ $marker || $link =~ $marker || $pax_match;
      if ($type eq "0") {
        defined(sysseek($fh, $data, 0)) or exit 2; my $carry = q{}; my $left = $member_size;
        while ($left) { my $want = $left > 65536 ? 65536 : $left; my $chunk = read_exact($fh, $want); defined $chunk or exit 2; my $value = $carry . $chunk; $found = 1 if $value =~ $marker; $carry = length($value) > 7 ? substr($value, -7) : $value; $left -= $want }
      }
      $offset = $data + $padded;
    }
    $offset == $size && !$pax or exit 2; exit($found ? 0 : 1);
  ' "$running_archive_path"
}

stopped_container_validate() {
  stopped_id=$1
  stopped_configuration=${2-}
  stopped_image_first=$(temp_path); stopped_image_hash=$(temp_path)
  stopped_fs_first=$(temp_path); stopped_fs_hash=$(temp_path)
  stopped_image_fifo=$(temp_path); stopped_image_status=$(temp_path)
  stopped_image_hash_fifo=$(temp_path); stopped_image_hash_status=$(temp_path)
  stopped_fs_fifo=$(temp_path); stopped_fs_status=$(temp_path)
  stopped_fs_hash_fifo=$(temp_path); stopped_fs_hash_status=$(temp_path)
  stopped_cleanup() { rm -f "$stopped_image_first" "$stopped_image_hash" "$stopped_fs_first" "$stopped_fs_hash" "$stopped_image_fifo" "$stopped_image_status" "$stopped_image_hash_fifo" "$stopped_image_hash_status" "$stopped_fs_fifo" "$stopped_fs_status" "$stopped_fs_hash_fifo" "$stopped_fs_hash_status"; }
  stopped_image_id=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Image}}' "$stopped_id") || { stopped_cleanup; return 2; }
  printf '%s\n' "$stopped_image_id" | /usr/bin/grep -Eq '^sha256:[0-9a-f]{64}$' || { stopped_cleanup; return 2; }
  stopped_image_id_again=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Image}}' "$stopped_id") || { stopped_cleanup; return 2; }
  [ "$stopped_image_id" = "$stopped_image_id_again" ] || { stopped_cleanup; return 2; }
  stopped_now=$(running_container_now) || { stopped_cleanup; return 2; }
  stopped_deadline=$((stopped_now + RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS))
  running_container_archive_save_bounded image "$stopped_image_id" "$stopped_image_first" "$stopped_image_fifo" "$stopped_image_status" "$stopped_deadline" || { stopped_cleanup; return 2; }
  stopped_image_sha=$(sha "$stopped_image_first") || { stopped_cleanup; return 2; }
  stopped_image_second_sha=$(running_container_archive_hash_stream image "$stopped_image_id" "$stopped_image_hash" "$stopped_image_hash_fifo" "$stopped_image_hash_status" "$stopped_deadline") || { stopped_cleanup; return 2; }
  [ "$stopped_image_sha" = "$stopped_image_second_sha" ] || { stopped_cleanup; return 2; }
  rm -f "$stopped_image_first" "$stopped_image_hash"
  stopped_now=$(running_container_now) || { stopped_cleanup; return 2; }
  stopped_deadline=$((stopped_now + RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS))
  running_container_archive_save_bounded container "$stopped_id" "$stopped_fs_first" "$stopped_fs_fifo" "$stopped_fs_status" "$stopped_deadline" || { stopped_cleanup; return 2; }
  stopped_fs_sha=$(sha "$stopped_fs_first") || { stopped_cleanup; return 2; }
  stopped_fs_second_sha=$(running_container_archive_hash_stream container "$stopped_id" "$stopped_fs_hash" "$stopped_fs_hash_fifo" "$stopped_fs_hash_status" "$stopped_deadline") || { stopped_cleanup; return 2; }
  [ "$stopped_fs_sha" = "$stopped_fs_second_sha" ] || { stopped_cleanup; return 2; }
  if running_container_archive_matches "$stopped_fs_first"; then stopped_filesystem_match=0; else stopped_filesystem_match=$?; fi
  [ "$stopped_filesystem_match" -eq 0 ] || [ "$stopped_filesystem_match" -eq 1 ] || { stopped_cleanup; return 2; }
  stopped_state=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$stopped_id") || { stopped_cleanup; return 2; }
  stopped_state_again=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$stopped_id") || { stopped_cleanup; return 2; }
  stopped_image_final=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Image}}' "$stopped_id") || { stopped_cleanup; return 2; }
  [ "$stopped_state" = false ] && [ "$stopped_state_again" = false ] && [ "$stopped_image_final" = "$stopped_image_id" ] || { stopped_cleanup; return 2; }
  stopped_configuration_sha=$(hash_text "$stopped_configuration") || { stopped_cleanup; return 2; }
  stopped_identity_sha=$(hash_text "$stopped_id:$stopped_image_id") || { stopped_cleanup; return 2; }
  [ "$stopped_filesystem_match" -eq 0 ] && printf 'stopped-container-filesystem:%s|%s|%s\n' "$stopped_identity_sha" "$stopped_configuration_sha" "$stopped_fs_sha"
  stopped_cleanup
  return 0
}
running_container_validate_json() {
  running_json_file=$1
  running_json_kind=$2
  case "$running_json_kind" in
    path)
      /usr/bin/jq -e 'type == "string" and if startswith("/") then test("^/[A-Za-z0-9._/-]+$") and (test("(^|/)\\.\\.?(/|$)") | not) else test("^[A-Za-z0-9][A-Za-z0-9._+-]*$") and . != "." and . != ".." end' "$running_json_file" >/dev/null || return 2
      ;;
    args)
      /usr/bin/jq -e 'type == "array" and length <= 256 and all(.[]; type == "string" and ((startswith("/") | not) or (test("^/[A-Za-z0-9._/-]+$") and (test("(^|/)\\.\\.?(/|$)") | not))))' "$running_json_file" >/dev/null || return 2
      ;;
    env)
      /usr/bin/jq -e 'type == "array" and length <= 256 and all(.[]; type == "string" and test("^[A-Za-z_][A-Za-z0-9_]*=") and ((test("[\u0000-\u001f]") | not) or test("^DOCKER_PG_LLVM_DEPS=[A-Za-z0-9.+_-]+([ \\t]+[A-Za-z0-9.+_-]+)*$")))' "$running_json_file" >/dev/null || return 2
      ;;
    health)
      /usr/bin/jq -e 'if . == null then true elif type != "object" or (.Test|type) != "array" or any(.Test[]; type != "string") then false elif .Test == ["NONE"] then true elif .Test[0] == "CMD-SHELL" and (.Test|length) == 2 and (.Test[1]|length) > 0 then true elif .Test[0] == "CMD" and (.Test|length) >= 2 then true else false end' "$running_json_file" >/dev/null || return 2
      ;;
    mounts)
      /usr/bin/jq -e 'type == "array" and all(.[]; type == "object")' "$running_json_file" >/dev/null || return 2
      ;;
    *) return 2 ;;
  esac
}

running_container_socket_env_matches() {
  running_socket_id=$1
  running_socket_env=$2
  [ "$running_socket_env" = /run/docker.sock ] || [ "$running_socket_env" = /var/run/docker.sock ] || return 2
  running_socket_mounts=$(temp_path)
  running_socket_mounts_again=$(temp_path)
  running_socket_records=$(temp_path)
  type container_docker_socket_source_is_canonical >/dev/null 2>&1 || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_socket_source_path=''; running_socket_source_resolved_before=''; running_socket_source_identity_before=''; running_socket_canonical_identity_before=''
  running_socket_canonical_identity_before=$(container_docker_socket_identity "$CANONICAL_DOCKER_SOCKET") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_container_pair "$running_socket_id" '{{json .Mounts}}' "$running_socket_mounts" "$running_socket_mounts_again" || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  /usr/bin/jq -r --arg destination "$running_socket_env" '.[] | select(type == "object" and .Type == "bind" and (.Source == "/run/docker.sock" or .Source == "/var/run/docker.sock") and .Destination == $destination) | [.Source, .Destination] | @tsv' "$running_socket_mounts" >"$running_socket_records" || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_socket_found=0; while IFS="$(printf '\t')" read -r running_socket_source running_socket_destination || [ -n "$running_socket_source$running_socket_destination" ]; do
    [ -n "$running_socket_source" ] && container_docker_socket_source_is_canonical "$running_socket_source" && container_docker_socket_destination_is_canonical "$running_socket_destination" || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
    [ "$running_socket_found" -eq 0 ] || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
    running_socket_source_path=$running_socket_source
    running_socket_source_resolved_before=$(readlink -f -- "$running_socket_source_path") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
    running_socket_source_identity_before=$(container_docker_socket_identity "$running_socket_source_path") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
    [ "$running_socket_source_identity_before" = "$running_socket_canonical_identity_before" ] || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
    running_socket_found=$((running_socket_found + 1))
  done <"$running_socket_records"
  [ "$running_socket_found" -eq 1 ] || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  container_docker_socket_source_is_canonical "$running_socket_source_path" || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_socket_source_resolved_after=$(readlink -f -- "$running_socket_source_path") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_socket_source_identity_after=$(container_docker_socket_identity "$running_socket_source_path") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  running_socket_canonical_identity_after=$(container_docker_socket_identity "$CANONICAL_DOCKER_SOCKET") || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  [ "$running_socket_source_resolved_before" = "$running_socket_source_resolved_after" ] && [ "$running_socket_source_resolved_after" = "$CANONICAL_DOCKER_SOCKET" ] && [ "$running_socket_source_identity_before" = "$running_socket_source_identity_after" ] && [ "$running_socket_canonical_identity_before" = "$running_socket_canonical_identity_after" ] && [ "$running_socket_source_identity_after" = "$running_socket_canonical_identity_after" ] || { rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"; return 2; }
  rm -f "$running_socket_mounts" "$running_socket_mounts_again" "$running_socket_records"
}

running_container_validate() {
  running_id=$1
  running_name=$2
  running_configuration=$3
  running_name_first=$(temp_path); running_name_second=$(temp_path)
  running_state_first=$(temp_path); running_state_second=$(temp_path)
  running_image_first=$(temp_path); running_image_second=$(temp_path)
  running_path_first=$(temp_path); running_path_second=$(temp_path)
  running_working_first=$(temp_path); running_working_second=$(temp_path)
  running_args_first=$(temp_path); running_args_second=$(temp_path)
  running_env_first=$(temp_path); running_env_second=$(temp_path)
  running_health_first=$(temp_path); running_health_second=$(temp_path)
  running_mounts_first=$(temp_path); running_mounts_second=$(temp_path)
  running_image_save_first=''; running_image_save_fifo=''; running_image_save_status=''; running_image_hash=''; running_image_hash_fifo=''; running_image_hash_status=''
  running_filesystem_save_first=''; running_filesystem_save_fifo=''; running_filesystem_save_status=''; running_filesystem_hash=''; running_filesystem_hash_fifo=''; running_filesystem_hash_status=''
  running_cleanup() { rm -f "$running_name_first" "$running_name_second" "$running_state_first" "$running_state_second" "$running_image_first" "$running_image_second" "$running_path_first" "$running_path_second" "$running_working_first" "$running_working_second" "$running_args_first" "$running_args_second" "$running_env_first" "$running_env_second" "$running_health_first" "$running_health_second" "$running_mounts_first" "$running_mounts_second" ${running_image_save_first:-} ${running_image_save_fifo:-} ${running_image_save_status:-} ${running_image_hash:-} ${running_image_hash_fifo:-} ${running_image_hash_status:-} ${running_filesystem_save_first:-} ${running_filesystem_save_fifo:-} ${running_filesystem_save_status:-} ${running_filesystem_hash:-} ${running_filesystem_hash_fifo:-} ${running_filesystem_hash_status:-}; }
  running_container_pair "$running_id" '{{.Name}}' "$running_name_first" "$running_name_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .State.Running}}' "$running_state_first" "$running_state_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{.Image}}' "$running_image_first" "$running_image_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .Path}}' "$running_path_first" "$running_path_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .Config.WorkingDir}}' "$running_working_first" "$running_working_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .Args}}' "$running_args_first" "$running_args_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .Config.Env}}' "$running_env_first" "$running_env_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json (index .Config "Healthcheck")}}' "$running_health_first" "$running_health_second" || { running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .Mounts}}' "$running_mounts_first" "$running_mounts_second" || { running_cleanup; return 2; }
  [ "$(cat "$running_name_first")" = "$running_name" ] || { running_cleanup; return 2; }
  [ "$(cat "$running_state_first")" = true ] || { running_cleanup; return 2; }
  running_image_id=$(cat "$running_image_first")
  printf '%s\n' "$running_image_id" | /usr/bin/grep -Eq '^sha256:[0-9a-f]{64}$' || { running_cleanup; return 2; }
  running_container_validate_json "$running_path_first" path || { running_cleanup; return 2; }
  /usr/bin/jq -e 'type == "string" and (. == "" or . == "/" or (test("^/[A-Za-z0-9._/-]+$") and (test("(^|/)\\.\\.?(/|$)") | not)))' "$running_working_first" >/dev/null || { running_cleanup; return 2; }
  running_container_validate_json "$running_args_first" args || { running_cleanup; return 2; }
  running_container_validate_json "$running_env_first" env || { running_cleanup; return 2; }
  running_container_validate_json "$running_health_first" health || { running_cleanup; return 2; }
  running_container_validate_json "$running_mounts_first" mounts || { running_cleanup; return 2; }
  running_env_entries=$(temp_path)
  /usr/bin/jq -r '.[]' "$running_env_first" >"$running_env_entries" || { rm -f "$running_env_entries"; running_cleanup; return 2; }
  running_socket_count=0
  while IFS= read -r running_env_entry || [ -n "$running_env_entry" ]; do
    running_env_name=${running_env_entry%%=*}; running_env_value=${running_env_entry#*=}
    case "$running_env_name:$running_env_value" in
      DOCKER_SOCK:/run/docker.sock|DOCKER_SOCK:/var/run/docker.sock)
        running_socket_count=$((running_socket_count + 1)); [ "$running_socket_count" -eq 1 ] || { rm -f "$running_env_entries"; running_cleanup; return 2; }
        running_container_socket_env_matches "$running_id" "$running_env_value" || { rm -f "$running_env_entries"; running_cleanup; return 2; }
        ;;
      DOCKER_SOCK:*) rm -f "$running_env_entries"; running_cleanup; return 2 ;;
    esac
  done <"$running_env_entries"
  rm -f "$running_env_entries"
  running_configuration_sha=$(hash_text "$running_configuration") || { running_cleanup; return 2; }
  running_metadata_bundle=$(temp_path)
  cat "$running_path_first" "$running_args_first" "$running_env_first" "$running_health_first" >"$running_metadata_bundle" || { rm -f "$running_metadata_bundle"; running_cleanup; return 2; }
  running_metadata_sha=$(sha "$running_metadata_bundle") || { rm -f "$running_metadata_bundle"; running_cleanup; return 2; }
  rm -f "$running_metadata_bundle"
  running_image_cache="$TEMP_ROOT/running-image-${running_image_id#sha256:}.cache"
  if [ -e "$running_image_cache" ] || [ -L "$running_image_cache" ]; then
    [ -f "$running_image_cache" ] && [ ! -L "$running_image_cache" ] || { running_cleanup; return 2; }
    IFS=' ' read -r running_image_sha running_image_match running_image_extra <"$running_image_cache" || { running_cleanup; return 2; }
    printf '%s\n' "$running_image_sha" | /usr/bin/grep -Eq '^[0-9a-f]{64}$' && { [ "$running_image_match" = 0 ] || [ "$running_image_match" = 1 ]; } && [ -z "$running_image_extra" ] || { running_cleanup; return 2; }
  else
    running_image_save_first=$(temp_path); running_image_save_fifo=$(temp_path); running_image_save_status=$(temp_path)
    running_image_hash=$(temp_path); running_image_hash_fifo=$(temp_path); running_image_hash_status=$(temp_path)
    running_image_started_at=$(running_container_now) || { running_cleanup; return 2; }
    running_image_deadline=$((running_image_started_at + RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS))
    running_container_archive_save_bounded image "$running_image_id" "$running_image_save_first" "$running_image_save_fifo" "$running_image_save_status" "$running_image_deadline" || { container_scan_note_failure "$running_id" image-archive 2; running_cleanup; return 2; }
    running_image_sha=$(sha "$running_image_save_first") || { running_cleanup; return 2; }
    running_image_second_sha=$(running_container_archive_hash_stream image "$running_image_id" "$running_image_hash" "$running_image_hash_fifo" "$running_image_hash_status" "$running_image_deadline") || { container_scan_note_failure "$running_id" image-archive 2; running_cleanup; return 2; }
    [ "$running_image_sha" = "$running_image_second_sha" ] || { container_scan_note_failure "$running_id" image-archive 2; running_cleanup; return 2; }
    running_image_projection_started_at=$(running_container_now) || { running_cleanup; return 2; }
    case "$running_image_projection_started_at" in ''|*[!0-9]*) running_cleanup; return 2;; esac
    running_image_projection_deadline=$((running_image_projection_started_at + RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS))
    case "$running_image_projection_deadline" in ''|*[!0-9]*) running_cleanup; return 2;; esac
    if running_container_image_matches_merged "$running_image_save_first" "$running_image_projection_deadline"; then running_image_match=1; else running_match_status=$?; [ "$running_match_status" -eq 1 ] || { container_scan_note_failure "$running_id" image-projection 2; running_cleanup; return 2; }; running_image_match=0; fi
    running_image_cache_pending=$(temp_path)
    if ! printf '%s %s\n' "$running_image_sha" "$running_image_match" >"$running_image_cache_pending" || ! mv "$running_image_cache_pending" "$running_image_cache"; then
      rm -f "$running_image_cache_pending"; running_cleanup; return 2
    fi
  fi
  running_filesystem_save_first=$(temp_path); running_filesystem_save_fifo=$(temp_path); running_filesystem_save_status=$(temp_path)
  running_filesystem_hash=$(temp_path); running_filesystem_hash_fifo=$(temp_path); running_filesystem_hash_status=$(temp_path)
  running_filesystem_started_at=$(running_container_now) || { running_cleanup; return 2; }
  running_filesystem_deadline=$((running_filesystem_started_at + RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS))
  running_container_archive_save_bounded container "$running_id" "$running_filesystem_save_first" "$running_filesystem_save_fifo" "$running_filesystem_save_status" "$running_filesystem_deadline" || { container_scan_note_failure "$running_id" filesystem-export 2; running_cleanup; return 2; }
  running_filesystem_sha=$(sha "$running_filesystem_save_first") || { running_cleanup; return 2; }
  running_filesystem_second_sha=$(running_container_archive_hash_stream container "$running_id" "$running_filesystem_hash" "$running_filesystem_hash_fifo" "$running_filesystem_hash_status" "$running_filesystem_deadline") || { container_scan_note_failure "$running_id" filesystem-export 2; running_cleanup; return 2; }
  [ "$running_filesystem_sha" = "$running_filesystem_second_sha" ] || { container_scan_note_failure "$running_id" filesystem-export 2; running_cleanup; return 2; }
  if running_container_archive_matches "$running_filesystem_save_first"; then running_match_status=0; else running_match_status=$?; fi
  [ "$running_match_status" -eq 0 ] || [ "$running_match_status" -eq 1 ] || { running_cleanup; return 2; }
  [ "$running_match_status" -eq 0 ] && running_filesystem_match=1 || running_filesystem_match=0
  running_filesystem_terminal_started_at=$(running_container_now) || { running_cleanup; return 2; }
  case "$running_filesystem_terminal_started_at" in ''|*[!0-9]*) running_cleanup; return 2;; esac
  running_filesystem_terminal_deadline=$((running_filesystem_terminal_started_at + RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS))
  running_filesystem_terminal_sha=$(running_container_archive_hash_stream container "$running_id" "$running_filesystem_hash" "$running_filesystem_hash_fifo" "$running_filesystem_hash_status" "$running_filesystem_terminal_deadline") || { container_scan_note_failure "$running_id" filesystem-export 2; running_cleanup; return 2; }
  [ "$running_filesystem_sha" = "$running_filesystem_terminal_sha" ] || { container_scan_note_failure "$running_id" filesystem-export 2; running_cleanup; return 2; }
  running_name_recheck=$(temp_path); running_name_recheck_again=$(temp_path)
  running_state_recheck=$(temp_path); running_state_recheck_again=$(temp_path)
  running_image_recheck=$(temp_path); running_image_recheck_again=$(temp_path)
  running_container_pair "$running_id" '{{.Name}}' "$running_name_recheck" "$running_name_recheck_again" || { rm -f "$running_name_recheck" "$running_name_recheck_again" "$running_state_recheck" "$running_state_recheck_again" "$running_image_recheck" "$running_image_recheck_again"; running_cleanup; return 2; }
  running_container_pair "$running_id" '{{json .State.Running}}' "$running_state_recheck" "$running_state_recheck_again" || { rm -f "$running_name_recheck" "$running_name_recheck_again" "$running_state_recheck" "$running_state_recheck_again" "$running_image_recheck" "$running_image_recheck_again"; running_cleanup; return 2; }
  running_container_pair "$running_id" '{{.Image}}' "$running_image_recheck" "$running_image_recheck_again" || { rm -f "$running_name_recheck" "$running_name_recheck_again" "$running_state_recheck" "$running_state_recheck_again" "$running_image_recheck" "$running_image_recheck_again"; running_cleanup; return 2; }
  [ "$(cat "$running_name_recheck")" = "$running_name" ] && [ "$(cat "$running_state_recheck")" = true ] && [ "$(cat "$running_image_recheck")" = "$running_image_id" ] || { rm -f "$running_name_recheck" "$running_name_recheck_again" "$running_state_recheck" "$running_state_recheck_again" "$running_image_recheck" "$running_image_recheck_again"; running_cleanup; return 2; }
  rm -f "$running_name_recheck" "$running_name_recheck_again" "$running_state_recheck" "$running_state_recheck_again" "$running_image_recheck" "$running_image_recheck_again"
  if [ "$running_image_match" -eq 1 ]; then
    running_identity_sha=$(hash_text "$running_id:$running_image_id") || { running_cleanup; return 2; }
    printf 'running-container-image:%s|%s|%s\n' "$running_identity_sha" "$running_configuration_sha" "$running_image_sha"
  fi
  if [ "$running_filesystem_match" -eq 1 ]; then
    running_filesystem_identity_sha=$(hash_text "$running_id:$running_image_id") || { running_cleanup; return 2; }
    printf 'running-container-filesystem:%s|%s|%s\n' "$running_filesystem_identity_sha" "$running_configuration_sha" "$running_filesystem_sha"
  fi
  if /usr/bin/grep -Eqi 'ollama|11434' "$running_env_first" "$running_args_first" "$running_health_first" "$running_path_first"; then
    running_metadata_identity_sha=$(hash_text "$running_id:$running_image_id") || { running_cleanup; return 2; }
    printf 'running-container-metadata:%s|%s\n' "$running_metadata_identity_sha" "$running_metadata_sha"
  else
    running_grep_status=$?
    [ "$running_grep_status" -eq 1 ] || { running_cleanup; return 2; }
  fi
  running_cleanup
  return 0
}
