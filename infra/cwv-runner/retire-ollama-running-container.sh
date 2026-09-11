#!/bin/sh
# Running-container validation never uses docker cp. Stopped-container file
# closure remains in retire-ollama-consumer-closure.sh.

container_scan_diagnostic_phase() {
  case "$1" in
    bind-directory|bind-mounts|configuration|container-name|container-snapshot|docker-socket|filesystem-export|final-configuration|final-name|final-state|healthcheck|image-archive|image-projection|inventory-refresh|network-mode|running-container|state|stopped-container|stopped-arguments|stopped-environment|stopped-options|tmpfs-mount|volume-snapshot) return 0 ;;
    *) return 2 ;;
  esac
}

container_scan_note_failure() {
  diagnostic_id=$1; diagnostic_phase=$2; diagnostic_status=$3; diagnostic_file=${CONTAINER_SCAN_DIAGNOSTIC_FILE:-}
  case "$diagnostic_file" in "$TEMP_ROOT"/file.*) :;; *) return 0;; esac
  [ -f "$diagnostic_file" ] && [ ! -L "$diagnostic_file" ] && [ ! -s "$diagnostic_file" ] || return 0
  case "$diagnostic_id" in ''|*[!0-9a-f]*) return 0;; esac
  [ "${#diagnostic_id}" -eq 64 ] && container_scan_diagnostic_phase "$diagnostic_phase" || return 0
  case "$diagnostic_status" in ''|0|*[!0-9]*) return 0;; esac
  printf '%s\n' "$diagnostic_phase" >"$diagnostic_file" 2>/dev/null || :
  return 0
}

container_scan_publish_failure() {
  diagnostic_publish_id=$1; diagnostic_publish_status=$2; diagnostic_publish_phase=${3:-}; diagnostic_publish_file=${CONTAINER_SCAN_DIAGNOSTIC_FILE:-}
  if [ -z "$diagnostic_publish_phase" ]; then case "$diagnostic_publish_file" in "$TEMP_ROOT"/file.*) [ -f "$diagnostic_publish_file" ] && [ ! -L "$diagnostic_publish_file" ] && diagnostic_publish_phase=$(cat "$diagnostic_publish_file" 2>/dev/null) || :;; esac; fi
  container_scan_diagnostic_phase "$diagnostic_publish_phase" || diagnostic_publish_phase=container-snapshot
  case "$diagnostic_publish_id" in ''|*[!0-9a-f]*) return 0;; esac
  [ "${#diagnostic_publish_id}" -eq 64 ] || return 0
  case "$diagnostic_publish_status" in ''|0|*[!0-9]*) return 0;; esac
  CONTAINER_SCAN_PUBLISHED_FAILURE=yes; printf 'container-scan-failure id=%s phase=%s status=%s\n' "$diagnostic_publish_id" "$diagnostic_publish_phase" "$diagnostic_publish_status" >&2
}

running_container_pair() {
  running_pair_id=$1
  running_pair_format=$2
  running_pair_first=$3
  running_pair_second=$4
  if [ "$running_pair_format" = '{{json .Mounts}}' ]; then
    container_mounts_snapshot "$running_pair_id" "$running_pair_first" || return 2
    container_mounts_snapshot "$running_pair_id" "$running_pair_second" || return 2
  else
    docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f "$running_pair_format" "$running_pair_id" >"$running_pair_first" || return 2
    docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f "$running_pair_format" "$running_pair_id" >"$running_pair_second" || return 2
  fi
  cmp -s "$running_pair_first" "$running_pair_second" || return 2
}

running_container_lifecycle() { running_lifecycle=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '[{{json .State.StartedAt}},{{json .State.Pid}},{{json .RestartCount}}]' "$1") || return 2; printf '%s\n' "$running_lifecycle" | /usr/bin/jq -e 'type == "array" and length == 3 and (.[0]|type == "string" and length > 0) and (.[1]|type == "number" and floor == . and . > 0) and (.[2]|type == "number" and floor == . and . >= 0)' >/dev/null || return 2; printf '%s\n' "$running_lifecycle"; }

container_mounts_snapshot() {
  mount_container_id=$1
  mount_output=$2
  mount_raw=$(temp_path)
  docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .Mounts}}' "$mount_container_id" >"$mount_raw" || { rm -f "$mount_raw"; return 2; }
  /usr/bin/jq -cS 'if type == "array" and all(.[]; type == "object") then sort_by([.Destination, .Type, .Name, .Source, .Driver, .Mode, .RW, .Propagation]) else error("invalid mounts") end' "$mount_raw" >"$mount_output" || { rm -f "$mount_raw" "$mount_output"; return 2; }
  rm -f "$mount_raw"
}

PROJECTOR_AUTH_HELPER="${SCRIPT_DIR:-$(dirname -- "$0")}/retire-ollama-projector-auth.sh"
[ -f "$PROJECTOR_AUTH_HELPER" ] && [ ! -L "$PROJECTOR_AUTH_HELPER" ] || return 2
type source_loader_source >/dev/null 2>&1 || return 2
source_loader_source "$PROJECTOR_AUTH_HELPER" || return 2
PROJECTOR_AUTH_HELPER_SHA=$SOURCE_LOADER_DIGEST
[ -z "${RECOVERY_PROJECTOR_AUTH_SHA:-}" ] || [ "$PROJECTOR_AUTH_HELPER_SHA" = "$RECOVERY_PROJECTOR_AUTH_SHA" ] || return 2


RUNNING_CONTAINER_VALIDATION_HELPER="${SCRIPT_DIR:-$(dirname -- "$0")}/retire-ollama-running-container-validation.sh"
[ -f "$RUNNING_CONTAINER_VALIDATION_HELPER" ] && [ ! -L "$RUNNING_CONTAINER_VALIDATION_HELPER" ] || return 2
source_loader_source "$RUNNING_CONTAINER_VALIDATION_HELPER" || return 2
RUNNING_CONTAINER_VALIDATION_HELPER_SHA=$SOURCE_LOADER_DIGEST
[ -z "${RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA:-}" ] || [ "$RUNNING_CONTAINER_VALIDATION_HELPER_SHA" = "$RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA" ] || return 2

running_container_project_image() { running_image_seconds=$1; running_image_projector=$2; running_image_archive=$3; running_image_scratch=${4:-}; running_image_expected_sha=$5; running_image_projection=$(running_container_projector_execute "$running_image_seconds" "$running_image_projector" "$running_image_archive" "$running_image_scratch" "$running_image_expected_sha") || return 2; case "$running_image_projection" in 0) return 1;; 1) return 0;; *) return 2;; esac; }

running_container_image_matches_merged() {
  running_image_archive=$1
  running_image_deadline=${2-}
  case "$running_image_deadline" in ''|*[!0-9]*) return 2;; esac
  running_image_now=$(running_container_now) || return 2
  case "$running_image_now" in ''|*[!0-9]*) return 2;; esac
  [ "$running_image_now" -lt "$running_image_deadline" ] || return 2
  running_image_remaining=$((running_image_deadline - running_image_now))
  running_image_projector="$SCRIPT_DIR/retire-ollama-image-filesystem.pl"
  running_projector_expected_sha=$(running_container_projector_authorize "$running_image_projector") || return 2
  running_container_project_image "$running_image_remaining" "$running_image_projector" "$running_image_archive" "${TEMP_ROOT:-}" "$running_projector_expected_sha"
}


container_scan_bindings() {
  scan_id=$1
  scan_name=$2
  scan_line=$3
  scan_state=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" state "$scan_status"; return 2; }
  case "$scan_state" in
    true)
      scan_lifecycle=$(running_container_lifecycle "$scan_id") && scan_lifecycle_again=$(running_container_lifecycle "$scan_id") && [ "$scan_lifecycle" = "$scan_lifecycle_again" ] || { container_scan_note_failure "$scan_id" running-container 2; return 2; }
      scan_bound=$(container_bind_mount_consumers "$scan_id" || { scan_status=$?; container_scan_note_failure "$scan_id" bind-mounts "$scan_status"; return "$scan_status"; }) || return 2
      running_container_validate "$scan_id" "$scan_name" "$scan_line" || { scan_status=$?; container_scan_note_failure "$scan_id" running-container "$scan_status"; return "$scan_status"; }
      scan_bound_after=$(container_bind_mount_consumers "$scan_id" || { scan_status=$?; container_scan_note_failure "$scan_id" bind-mounts "$scan_status"; return "$scan_status"; }) || return 2
      if [ -n "$scan_bound_after" ]; then
        if [ -n "$scan_bound" ]; then
          scan_bound=$(printf '%s\n%s\n' "$scan_bound" "$scan_bound_after" | sort -u) || return 2
        else
          scan_bound=$scan_bound_after
        fi
      fi
      ;;
    false)
      scan_bound=$(stopped_container_validate "$scan_id" "$scan_line") || { scan_status=$?; container_scan_note_failure "$scan_id" stopped-container "$scan_status"; return "$scan_status"; }
      scan_stopped_consumers=$( {
        container_bind_mount_consumers "$scan_id" || { scan_status=$?; container_scan_note_failure "$scan_id" bind-mounts "$scan_status"; return "$scan_status"; }
        container_argument_consumers "$scan_id" "$scan_line" || { scan_status=$?; container_scan_note_failure "$scan_id" stopped-arguments "$scan_status"; return "$scan_status"; }
        container_option_argument_consumers "$scan_id" "$scan_line" || { scan_status=$?; container_scan_note_failure "$scan_id" stopped-options "$scan_status"; return "$scan_status"; }
        container_environment_consumers "$scan_id" "$scan_line" || { scan_status=$?; container_scan_note_failure "$scan_id" stopped-environment "$scan_status"; return "$scan_status"; }
        container_healthcheck_consumers "$scan_id" "$scan_line" || { scan_status=$?; container_scan_note_failure "$scan_id" healthcheck "$scan_status"; return "$scan_status"; }
      } ) || { scan_status=$?; return "$scan_status"; }
      if [ -n "$scan_stopped_consumers" ]; then if [ -z "$scan_bound" ]; then scan_bound=$scan_stopped_consumers; else scan_bound=$(printf '%s\n%s\n' "$scan_bound" "$scan_stopped_consumers" | sort -u) || return 2; fi; fi
      ;;
    *) container_scan_note_failure "$scan_id" state 2; return 2 ;;
  esac
  scan_configuration_after=$(container_configuration "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" final-configuration "$scan_status"; return 2; }
  scan_configuration_again=$(container_configuration "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" final-configuration "$scan_status"; return 2; }
  [ "$scan_configuration_after" = "$scan_configuration_again" ] && [ "$scan_configuration_after" = "$scan_line" ] || { container_scan_note_failure "$scan_id" final-configuration 2; return 2; }
  final_scan_name=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Name}}' "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" final-name "$scan_status"; return 2; }
  [ "$final_scan_name" = "$scan_name" ] || { container_scan_note_failure "$scan_id" final-name 2; return 2; }
  final_scan_state=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" final-state "$scan_status"; return 2; }
  final_scan_state_again=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{json .State.Running}}' "$scan_id") || { scan_status=$?; container_scan_note_failure "$scan_id" final-state "$scan_status"; return 2; }
  [ "$final_scan_state" = "$scan_state" ] && [ "$final_scan_state_again" = "$scan_state" ] || { container_scan_note_failure "$scan_id" final-state 2; return 2; }
  if [ "$scan_state" = true ]; then final_scan_lifecycle=$(running_container_lifecycle "$scan_id") && final_scan_lifecycle_again=$(running_container_lifecycle "$scan_id") && [ "$final_scan_lifecycle" = "$final_scan_lifecycle_again" ] && [ "$final_scan_lifecycle" = "$scan_lifecycle" ] || { container_scan_note_failure "$scan_id" final-state 2; return 2; }; fi
  if [ "$scan_state" = true ]; then
    [ -z "$scan_bound" ] || printf '%s\n' "$scan_bound"
    if printf '%s' "$scan_line" | /usr/bin/grep -Eqi 'ollama|11434'; then
      scan_line_sha=$(hash_text "$scan_line") || return 2
      printf 'running-container-configuration:%s\n' "$scan_line_sha"
    else
      scan_match_status=$?
      [ "$scan_match_status" -eq 1 ] || return 2
    fi
  else
    [ -z "$scan_bound" ] || printf '%s\n' "$scan_bound"
    if printf '%s' "$scan_line" | /usr/bin/grep -Eqi 'ollama|11434'; then
      printf '%s\n' "$scan_line"
    else
      scan_match_status=$?
      [ "$scan_match_status" -eq 1 ] || return 2
    fi
  fi
}
