#!/bin/sh
# Temporary storage must be disk-backed and large enough for both retained archives.
TEMP_ROOT_MAX_RETAINED_ARCHIVE_BYTES=5368709120
TEMP_ROOT_BOUNDED_OVERHEAD_BYTES=67108864

temp_root_test_mode() { [ "$(/usr/bin/id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; }
temp_root_stat_identity() {
  if [ -x /usr/bin/stat ] && /usr/bin/stat --version >/dev/null 2>&1; then
    /usr/bin/stat -Lc '%d:%i:%u:%g:%a' -- "$1"
  elif [ -x /usr/bin/stat ]; then
    /usr/bin/stat -f '%d:%i:%u:%g:%Lp' -- "$1"
  else
    command stat -Lc '%d:%i:%u:%g:%a' -- "$1"
  fi
}
temp_root_canonical_path() {
  [ -n "$1" ] || return 1
  if [ -x /usr/bin/readlink ]; then
    /usr/bin/readlink -f -- "$1"
  elif command -v realpath >/dev/null 2>&1; then
    realpath -- "$1"
  else
    command readlink -f -- "$1"
  fi
}
temp_root_mount_fstype() {
  if temp_root_test_mode && [ -n "${RETIRE_OLLAMA_TEST_FSTYPE:-}" ]; then
    printf '%s\n' "$RETIRE_OLLAMA_TEST_FSTYPE"
    return
  fi
  if command -v findmnt >/dev/null 2>&1; then
    findmnt -no FSTYPE --target "$1" | awk '
      NF == 1 { value=$1; count++; next }
      NF == 4 && $3 ~ /^[[:alnum:]_.-]+$/ { value=$3; count++; next }
      { bad=1 }
      END { if (bad || count != 1) exit 1; print value }
    '
    return $?
  fi
  temp_root_test_mode || return 1
  printf '%s\n' "${RETIRE_OLLAMA_TEST_FSTYPE:-apfs}"
}
temp_root_mount_identity() {
  if temp_root_test_mode && [ -n "${RETIRE_OLLAMA_TEST_FSTYPE:-}" ]; then
    printf 'test|test|%s|test\n' "$RETIRE_OLLAMA_TEST_FSTYPE"
    return
  fi
  if ! command -v findmnt >/dev/null 2>&1; then
    temp_root_test_mode || return 1
    printf 'test|test|%s|test\n' "${RETIRE_OLLAMA_TEST_FSTYPE:-apfs}"
    return
  fi
  findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$1" | awk '
    NF == 4 && $1 ~ /^\/[A-Za-z0-9._+@-]*([\/][A-Za-z0-9._+@-]+)*$/ && $2 ~ /^[^|[:space:]]+$/ && $3 ~ /^[[:alnum:]_.-]+$/ && $4 ~ /^[A-Za-z0-9_,=:.+@-]+$/ { value=$1 "|" $2 "|" $3 "|" $4; count++; next }
    { bad=1 }
    END { if (bad || count != 1) exit 1; print value }
  '
}
temp_root_available_bytes() {
  df -Pk "$1" | awk '
    function multiply_1024(input, result, position, digit, carry, product) {
      result = ""; carry = 0
      for (position = length(input); position > 0; position--) {
        digit = substr(input, position, 1) + 0
        product = digit * 1024 + carry
        result = (product % 10) result
        carry = int(product / 10)
      }
      while (carry > 0) {
        result = (carry % 10) result
        carry = int(carry / 10)
      }
      sub(/^0+/, "", result)
      return result == "" ? "0" : result
    }
    NR > 1 && $4 ~ /^[0-9]+$/ { value=multiply_1024($4); count++ }
    END { if (count != 1) exit 1; print value }
  '
}
temp_root_required_bytes() { printf '%s\n' $((TEMP_ROOT_MAX_RETAINED_ARCHIVE_BYTES + TEMP_ROOT_BOUNDED_OVERHEAD_BYTES)); }
temp_root_mount_fstype_field() { value=$1; value=${value#*|}; value=${value#*|}; value=${value%%|*}; printf '%s\n' "$value"; }
temp_root_identity_parts() {
  value=$1
  case "$value" in *:*:*:*:*) :;; *) return 1;; esac
  temp_root_identity_device=${value%%:*}; value=${value#*:}
  temp_root_identity_inode=${value%%:*}; value=${value#*:}
  temp_root_identity_uid=${value%%:*}; value=${value#*:}
  temp_root_identity_gid=${value%%:*}; value=${value#*:}
  temp_root_identity_mode=$value
  case "$temp_root_identity_device:$temp_root_identity_inode:$temp_root_identity_uid:$temp_root_identity_gid:$temp_root_identity_mode" in *[!0-9:]*) return 1;; esac
}
temp_root_verify_base() {
  temp_root_base_current=$(temp_root_canonical_path "$TEMP_ROOT_BASE") || return 1
  [ "$temp_root_base_current" = "$TEMP_ROOT_BASE" ] || return 1
  temp_root_base_identity_current=$(temp_root_stat_identity "$TEMP_ROOT_BASE") || return 1
  [ "$temp_root_base_identity_current" = "$TEMP_ROOT_BASE_IDENTITY" ] || return 1
  temp_root_base_mount_current=$(temp_root_mount_identity "$TEMP_ROOT_BASE") || return 1
  [ "$temp_root_base_mount_current" = "$TEMP_ROOT_BASE_MOUNT" ] || return 1
  temp_root_base_fstype_current=$(temp_root_mount_fstype "$TEMP_ROOT_BASE") || return 1
  [ "$temp_root_base_fstype_current" = "$TEMP_ROOT_BASE_FSTYPE" ] || return 1
  [ "$(temp_root_mount_fstype_field "$temp_root_base_mount_current")" = "$TEMP_ROOT_BASE_FSTYPE" ] || return 1
}
temp_root_verify_root() {
  [ -n "$TEMP_ROOT" ] && [ -d "$TEMP_ROOT" ] && [ ! -L "$TEMP_ROOT" ] || return 1
  temp_root_root_current=$(temp_root_canonical_path "$TEMP_ROOT") || return 1
  [ "$temp_root_root_current" = "$TEMP_ROOT" ] || return 1
  temp_root_root_identity_current=$(temp_root_stat_identity "$TEMP_ROOT") || return 1
  [ "$temp_root_root_identity_current" = "$TEMP_ROOT_IDENTITY" ] || return 1
  temp_root_identity_parts "$temp_root_root_identity_current" || return 1
  [ "$temp_root_identity_device" = "$TEMP_ROOT_BASE_DEVICE" ] && [ "$temp_root_identity_uid" = "$TEMP_ROOT_OWNER_UID" ] && [ "$temp_root_identity_gid" = "$TEMP_ROOT_OWNER_GID" ] && [ "$temp_root_identity_mode" = 700 ] || return 1
  [ "$(dirname -- "$TEMP_ROOT")" = "$TEMP_ROOT_BASE" ]
}
temp_root_revalidate_recorded() {
  temp_root_verify_base && temp_root_verify_root
}
temp_root_mktemp() {
  if [ -x /usr/bin/mktemp ]; then
    /usr/bin/mktemp "$@"
  elif [ -x /bin/mktemp ]; then
    /bin/mktemp "$@"
  else
    return 1
  fi
}
temp_root_chmod() {
  if [ -x /usr/bin/chmod ]; then
    /usr/bin/chmod "$@"
  elif [ -x /bin/chmod ]; then
    /bin/chmod "$@"
  else
    return 1
  fi
}
temp_root_rename() { /usr/bin/perl -e 'exit(rename($ARGV[0],$ARGV[1]) ? 0 : 1)' "$1" "$2"; }
temp_root_remove_owned() {
  target=$1; expected=$2; [ -n "$expected" ] || return 0
  [ ! -L "$target" ] && [ "$(temp_root_stat_identity "$target" 2>/dev/null)" = "$expected" ] || return 0
  target_parent=${target%/*}; [ "$target_parent" = "$target" ] && target_parent=.
  quarantine_root=$(temp_root_mktemp -d "$target_parent/.retire-ollama-cleanup.XXXXXX") || return 0
  temp_root_chmod 0700 "$quarantine_root" || { /bin/rm -rf -- "$quarantine_root"; return 0; }
  quarantine="$quarantine_root/root"
  [ ! -e "$quarantine" ] && [ ! -L "$quarantine" ] || { /bin/rmdir -- "$quarantine_root" 2>/dev/null || :; return 0; }
  temp_root_rename "$target" "$quarantine" || { /bin/rmdir -- "$quarantine_root" 2>/dev/null || :; return 0; }
  if [ ! -L "$quarantine" ] && [ "$(temp_root_stat_identity "$quarantine" 2>/dev/null)" = "$expected" ]; then
    /bin/rm -rf -- "$quarantine_root"
  else
    :
  fi
}
_cleanup_temp() { [ -n "${TEMP_ROOT:-}" ] && temp_root_remove_owned "$TEMP_ROOT" "${TEMP_ROOT_IDENTITY:-}"; TEMP_ROOT=''; TEMP_ROOT_IDENTITY=''; }
_init_temp_root() {
  base=${RETIRE_OLLAMA_TMPDIR:-${TMPDIR:-/tmp}}
  [ -d "$base" ] && [ ! -L "$base" ] || die 'unsafe temporary parent'
  base=$(temp_root_canonical_path "$base") || die 'temporary parent canonical path unavailable'
  [ -d "$base" ] && [ ! -L "$base" ] || die 'unsafe temporary parent'
  TEMP_ROOT_BASE=$base
  TEMP_ROOT_OWNER_UID=$(/usr/bin/id -u)
  TEMP_ROOT_OWNER_GID=$(/usr/bin/id -g)
  TEMP_ROOT_BASE_IDENTITY=$(temp_root_stat_identity "$base") || die 'temporary parent identity unavailable'
  temp_root_identity_parts "$TEMP_ROOT_BASE_IDENTITY" || die 'invalid temporary parent identity'
  [ "$temp_root_identity_uid" = "$TEMP_ROOT_OWNER_UID" ] || [ $((0$temp_root_identity_mode & 01000)) -ne 0 ] || die 'temporary parent owner mismatch'
  [ $((0$temp_root_identity_mode & 0022)) -eq 0 ] || [ $((0$temp_root_identity_mode & 01000)) -ne 0 ] || die 'temporary parent must be private or sticky'
  TEMP_ROOT_BASE_DEVICE=$temp_root_identity_device
  TEMP_ROOT_BASE_MOUNT=$(temp_root_mount_identity "$base") || die 'temporary parent mount identity unavailable'
  TEMP_ROOT_BASE_FSTYPE=$(temp_root_mount_fstype "$base") || die 'temporary parent filesystem type unavailable'
  case "$TEMP_ROOT_BASE_FSTYPE" in
    tmpfs|ramfs) die 'temporary parent must be disk-backed';;
    ''|*[![:alnum:]_.-]*) die 'invalid temporary parent filesystem type';;
  esac
  [ "$(temp_root_mount_fstype_field "$TEMP_ROOT_BASE_MOUNT")" = "$TEMP_ROOT_BASE_FSTYPE" ] || die 'temporary parent mount filesystem changed'
  TEMP_ROOT_REQUIRED_BYTES=$(temp_root_required_bytes)
  case "$TEMP_ROOT_REQUIRED_BYTES" in ''|*[!0-9]*) die 'invalid temporary storage requirement';; esac
  temp_root_base_available=$(temp_root_available_bytes "$base") || die 'temporary parent free space unavailable'
  case "$temp_root_base_available" in ''|*[!0-9]*) die 'invalid temporary parent free space';; esac
  [ "$temp_root_base_available" -ge "$TEMP_ROOT_REQUIRED_BYTES" ] || die 'insufficient temporary parent free space'
  temp_root_base_current=$(temp_root_canonical_path "$base") || die 'temporary parent changed before creation'
  [ "$temp_root_base_current" = "$base" ] || die 'temporary parent changed before creation'
  TEMP_ROOT=$(temp_root_mktemp -d "$base/retire-ollama.XXXXXX") || die 'temporary directory creation failed'
  TEMP_ROOT_IDENTITY=$(temp_root_stat_identity "$TEMP_ROOT") || { TEMP_ROOT=''; die 'temporary directory identity unavailable'; }
  temp_root_chmod 0700 "$TEMP_ROOT" || { temp_root_remove_owned "$TEMP_ROOT" "$TEMP_ROOT_IDENTITY"; TEMP_ROOT=''; TEMP_ROOT_IDENTITY=''; die 'temporary directory protection failed'; }
  temp_root_identity_parts "$TEMP_ROOT_IDENTITY" || { temp_root_remove_owned "$TEMP_ROOT" "$TEMP_ROOT_IDENTITY"; TEMP_ROOT=''; TEMP_ROOT_IDENTITY=''; die 'invalid temporary directory identity'; }
  temp_root_revalidate_recorded || { temp_root_remove_owned "$TEMP_ROOT" "$TEMP_ROOT_IDENTITY"; TEMP_ROOT=''; TEMP_ROOT_IDENTITY=''; die 'temporary storage changed during creation'; }
}
_temp_path() {
  [ -n "${TEMP_ROOT:-}" ] || die 'temporary directory not initialized'
  temp_root_verify_root || die 'temporary storage changed: temporary directory identity changed'
  temp_file=$(temp_root_mktemp "$TEMP_ROOT/file.XXXXXX") || die 'temporary file creation failed'
  temp_file_identity=$(temp_root_stat_identity "$temp_file") || die 'temporary file identity unavailable'
  case "$temp_file" in "$TEMP_ROOT"/file.*) :;; *) temp_root_remove_owned "$temp_file" "$temp_file_identity"; die 'temporary file path invalid';; esac
  [ -f "$temp_file" ] && [ ! -L "$temp_file" ] || { temp_root_remove_owned "$temp_file" "$temp_file_identity"; die 'temporary file unsafe'; }
  temp_root_verify_root || { temp_root_remove_owned "$temp_file" "$temp_file_identity"; die 'temporary storage changed: temporary directory identity changed'; }
  printf '%s\n' "$temp_file"
}
temp_root_sync_command() {
  if [ -x /usr/bin/sync ]; then
    /usr/bin/sync "$@"
  elif temp_root_test_mode && [ -x /bin/sync ]; then
    /bin/sync "$@"
  else
    return 1
  fi
}
temp_root_sync() {
  case "$(uname -s 2>/dev/null)" in
    Darwin) temp_root_test_mode || return 1; temp_root_sync_command;;
    *) temp_root_sync_command -f "$1";;
  esac
}
_fsync_file() { temp_root_sync "$1" || die "cannot sync $1"; }
_fsync_dir() { temp_root_sync "$1" || die "cannot sync directory $1"; }
