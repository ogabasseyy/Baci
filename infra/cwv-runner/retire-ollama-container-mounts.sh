#!/bin/sh

# Docker socket binds are accepted only when both sides use reviewed paths.
container_docker_socket_identity() {
  socket_path=$1
  test -S "$socket_path" || return 1
  socket_owner_mode=$(stat -Lc '%u:%a' "$socket_path") || return 1
  [ "$socket_owner_mode" = '0:660' ] || return 1
  stat -Lc '%d:%i:%f:%u:%g:%a' "$socket_path"
}

container_docker_socket_source_is_canonical() {
  socket_source=$1
  [ -n "${CANONICAL_DOCKER_SOCKET:-}" ] || return 1
  case "$socket_source" in /run/docker.sock|/var/run/docker.sock) :;; *) return 1;; esac
  resolved=$(readlink -f -- "$socket_source") || return 1
  [ "$resolved" = "$CANONICAL_DOCKER_SOCKET" ] || return 1
  source_identity=$(container_docker_socket_identity "$socket_source") || return 1
  canonical_identity=$(container_docker_socket_identity "$CANONICAL_DOCKER_SOCKET") || return 1
  [ "$source_identity" = "$canonical_identity" ]
}

container_docker_socket_destination_is_canonical() {
  case "$1" in /run/docker.sock|/var/run/docker.sock) return 0;; *) return 2;; esac
}

container_docker_socket_evidence() {
  case "$1" in ''|*[!A-Za-z0-9_.-]*) return 2;; esac
  socket_id_hash=$(hash_text "$1") || return 2
  socket_source_hash=$(hash_text "$2") || return 2
  socket_destination_hash=$(hash_text "$3") || return 2
  socket_canonical_hash=$(hash_text "$CANONICAL_DOCKER_SOCKET") || return 2
  printf 'container-docker-socket:%s:%s|%s|%s\n' "$socket_id_hash" "$socket_source_hash" "$socket_destination_hash" "$socket_canonical_hash"
}

container_mount_note_failure() {
  type container_scan_note_failure >/dev/null 2>&1 || return 0
  container_scan_note_failure "$1" "$2" "$3"
}

container_bind_mount_consumers() {
  mount_id=$1; mount_mounts=$(temp_path); mount_mounts_again=$(temp_path)
  container_mounts_snapshot "$mount_id" "$mount_mounts" && container_mounts_snapshot "$mount_id" "$mount_mounts_again" && cmp -s "$mount_mounts" "$mount_mounts_again" || { rm -f "$mount_mounts" "$mount_mounts_again"; return 2; }
  mount_bind_state=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$mount_id") && mount_bind_state_again=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$mount_id") && [ "$mount_bind_state" = "$mount_bind_state_again" ] && { [ "$mount_bind_state" = true ] || [ "$mount_bind_state" = false ]; } || { rm -f "$mount_mounts" "$mount_mounts_again"; return 2; }
  mount_paths=$(temp_path)
  mount_socket_evidence=$(temp_path)
  mount_file_records=$(temp_path)
  /usr/bin/printf '%s' '' >"$mount_socket_evidence" || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }
  /usr/bin/printf '%s' '' >"$mount_file_records" || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }
  /usr/bin/jq -r '
    def abs: type == "string" and startswith("/") and (test("[\\t\\r\\n]") | not) and (test("(^|/)\\.\\.?(/|$)") | not);
    if type != "array" or any(.[]; type != "object" or (.Type | type) != "string") then error("invalid mounts")
    else .[] | if .Type == "bind" then if (.Source | abs) and (.Destination | abs) then ["bind", .Source, .Destination] | @tsv else error("invalid bind mount") end
    elif .Type == "volume" then if (.Name | type) == "string" and (.Name | test("^[A-Za-z0-9][A-Za-z0-9_.-]*$")) and (.Source | abs) and (.Destination | abs) and .Driver == "local" and (.Mode | type) == "string" and (.RW | type) == "boolean" and (.Propagation | type) == "string" then ["volume", .Name, .Source, .Destination, .Driver] | @tsv else error("invalid volume mount") end
    elif .Type == "tmpfs" then if .Source == "" and (.Destination | abs) and (.Mode | type) == "string" and (.RW | type) == "boolean" and (.Propagation | type) == "string" and (.Name == null or .Name == "") then ["tmpfs", .Destination] | @tsv else error("invalid tmpfs mount") end
    else error("unsupported mount") end end
  ' "$mount_mounts" >"$mount_paths" || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
  mount_tab=$(printf '\t')
  mount_socket_source_path=''; mount_socket_source_resolved_before=''; mount_socket_source_identity_before=''; mount_socket_canonical_identity_before=''
  while IFS="$mount_tab" read -r mount_type mount_first mount_source mount_destination mount_driver <&3 || [ -n "$mount_type$mount_first$mount_source$mount_destination$mount_driver" ]; do
    case "$mount_type" in
      bind) mount_failure_phase=bind-mounts;;
      volume) mount_failure_phase=volume-snapshot;;
      tmpfs) mount_failure_phase=tmpfs-mount;;
      *) rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2;;
    esac
    if [ "$mount_type" = bind ] && [ -f "$mount_first" ] && [ ! -L "$mount_first" ]; then mount_file_size=$(stat -c '%s' "$mount_first") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; case "$mount_file_size" in ''|*[!0-9]*) rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2;; esac; [ "$mount_file_size" -le 67108864 ] || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; fi
    case "$mount_type" in
      bind)
        if container_docker_socket_source_is_canonical "$mount_first" && container_docker_socket_destination_is_canonical "$mount_source"; then
          [ ! -s "$mount_socket_evidence" ] || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          mount_socket_source_path=$mount_first
          mount_socket_source_resolved_before=$(readlink -f -- "$mount_socket_source_path") || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          mount_socket_source_identity_before=$(container_docker_socket_identity "$mount_socket_source_path") || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          mount_socket_canonical_identity_before=$(container_docker_socket_identity "$CANONICAL_DOCKER_SOCKET") || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          [ "$mount_socket_source_identity_before" = "$mount_socket_canonical_identity_before" ] || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          printf '%s\n' "$mount_socket_canonical_identity_before" >"$mount_socket_evidence" || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
          container_docker_socket_evidence "$mount_id" "$mount_socket_source_path" "$mount_source" >>"$mount_socket_evidence" || { container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
        else case "$mount_first" in /run/docker.sock|/var/run/docker.sock) container_mount_note_failure "$mount_id" docker-socket 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2;; esac; mount_real=$(readlink -f -- "$mount_first") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; [ "$mount_real" = "$mount_first" ] && [ ! -L "$mount_first" ] || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; if [ -d "$mount_first" ]; then container_bind_directory_consumers "$mount_id" "$mount_first" "$mount_source" || { mount_status=$?; container_mount_note_failure "$mount_id" bind-directory "$mount_status"; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return "$mount_status"; }; elif [ -f "$mount_first" ]; then if type consumer_snapshot >/dev/null 2>&1; then mount_captured=$(consumer_snapshot "$mount_first") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; mount_snapshot=${mount_captured%%|*}; mount_identity=${mount_captured#*|}; mount_content_sha=$(sha "$mount_snapshot") || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; mount_match=0; if consumer_matches "$mount_snapshot"; then mount_match=1; else mount_status=$?; [ "$mount_status" -eq 1 ] || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return "$mount_status"; }; fi; consumer_canonical_regular "$mount_first" >/dev/null && [ "$mount_identity" = "$(consumer_source_identity "$mount_first")" ] || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; [ "$mount_match" -eq 0 ] || printf 'container-bind-mount:%s:%s|%s|%s|%s\n' "$mount_id" "$mount_source" "$mount_first" "$mount_content_sha" "$mount_identity"; printf '%s\t%s\t%s\t%s\n' "$mount_first" "$mount_content_sha" "$mount_identity" "$mount_match" >>"$mount_file_records" || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; rm -f "$mount_snapshot"; fi; else rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; fi; fi
        ;;
      volume) container_volume_consumers "$mount_id" "$mount_first" "$mount_source" "$mount_destination" || { mount_status=$?; container_mount_note_failure "$mount_id" volume-snapshot "$mount_status"; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return "$mount_status"; } ;;
      tmpfs) [ "$mount_bind_state" = false ] || { container_mount_note_failure "$mount_id" tmpfs-mount 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; } ;;
      *) rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2 ;;
    esac
    mount_state_now=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$mount_id") || { container_mount_note_failure "$mount_id" "$mount_failure_phase" 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
    [ "$mount_state_now" = "$mount_bind_state" ] || { container_mount_note_failure "$mount_id" "$mount_failure_phase" 2; rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence"; return 2; }
  done 3<"$mount_paths"
  if [ -s "$mount_file_records" ]; then mount_record_tab=$(printf '\t'); while IFS="$mount_record_tab" read -r mount_file_path mount_expected_sha mount_expected_identity mount_expected_match || [ -n "$mount_file_path$mount_expected_sha$mount_expected_identity$mount_expected_match" ]; do mount_captured=$(consumer_snapshot "$mount_file_path") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; mount_snapshot=${mount_captured%%|*}; mount_identity=${mount_captured#*|}; mount_content_sha=$(sha "$mount_snapshot") || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; mount_match=0; if consumer_matches "$mount_snapshot"; then mount_match=1; else mount_status=$?; [ "$mount_status" -eq 1 ] || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return "$mount_status"; }; fi; consumer_canonical_regular "$mount_file_path" >/dev/null && [ "$mount_identity" = "$(consumer_source_identity "$mount_file_path")" ] && [ "$mount_content_sha" = "$mount_expected_sha" ] && [ "$mount_identity" = "$mount_expected_identity" ] && [ "$mount_match" = "$mount_expected_match" ] || { rm -f "$mount_snapshot" "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_socket_evidence" "$mount_file_records"; return 2; }; rm -f "$mount_snapshot"; done <"$mount_file_records"; fi
  mount_mounts_after=$(temp_path); container_mounts_snapshot "$mount_id" "$mount_mounts_after" && cmp -s "$mount_mounts" "$mount_mounts_after" || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
  mount_final_bind_state=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$mount_id") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence"; return 2; }
  [ "$mount_final_bind_state" = "$mount_bind_state" ] || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence"; return 2; }
  if [ -s "$mount_socket_evidence" ]; then
    [ -n "$mount_socket_source_path" ] && [ -n "$mount_socket_source_resolved_before" ] && [ -n "$mount_socket_source_identity_before" ] && [ -n "$mount_socket_canonical_identity_before" ] || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    container_docker_socket_source_is_canonical "$mount_socket_source_path" || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    mount_socket_source_resolved_after=$(readlink -f -- "$mount_socket_source_path") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    mount_socket_source_identity_after=$(container_docker_socket_identity "$mount_socket_source_path") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    mount_socket_canonical_identity_after=$(container_docker_socket_identity "$CANONICAL_DOCKER_SOCKET") || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    [ "$mount_socket_source_resolved_before" = "$mount_socket_source_resolved_after" ] && [ "$mount_socket_source_resolved_after" = "$CANONICAL_DOCKER_SOCKET" ] && [ "$mount_socket_source_identity_before" = "$mount_socket_source_identity_after" ] && [ "$mount_socket_canonical_identity_before" = "$mount_socket_canonical_identity_after" ] && [ "$mount_socket_source_identity_after" = "$mount_socket_canonical_identity_after" ] || { rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"; return 2; }
    sed -n '2,$p' "$mount_socket_evidence"
  fi
  rm -f "$mount_mounts" "$mount_mounts_again" "$mount_paths" "$mount_mounts_after" "$mount_socket_evidence" "$mount_file_records"
}
