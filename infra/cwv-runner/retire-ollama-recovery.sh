#!/bin/sh
# shellcheck disable=SC1090,SC1091 # Sealed sibling helpers are resolved at runtime.
recovery_proc_root_for_uid() { if [ "$1" = 0 ]; then printf /proc; else printf '%s' "${2:-/proc}"; fi; }
RECOVERY_PROC_ROOT=$(recovery_proc_root_for_uid "$(/usr/bin/id -u)" "${RETIRE_OLLAMA_PROC_ROOT:-}")
RECOVERY_CONTAINER_COMMAND_PATH=${RECOVERY_CONTAINER_COMMAND_PATH:-}
RECOVERY_CONTAINER_PORTS_FILE=${RECOVERY_CONTAINER_PORTS_FILE:-}
RECOVERY_SOURCE_SHA=${SCRIPT_DIR##*/}; RECOVERY_SOURCE_ROOT=/srv/baci-cwv/source; RECOVERY_RECEIPT_ROOT=/srv/baci-cwv/retired-ollama/recovery-scan; : "${RECOVERY_RECEIPT_ROOT}"
RECOVERY_CONSUMERS_HELPER="$SCRIPT_DIR/retire-ollama-consumers.sh"; RECOVERY_CONSUMER_MOUNTS_HELPER="$SCRIPT_DIR/retire-ollama-container-mounts.sh"; RECOVERY_RUNNING_CONTAINER_HELPER="$SCRIPT_DIR/retire-ollama-running-container.sh"; RECOVERY_RUNNING_CONTAINER_VALIDATION_HELPER="$SCRIPT_DIR/retire-ollama-running-container-validation.sh"; RECOVERY_RUNNING_ARCHIVE_HELPER="$SCRIPT_DIR/retire-ollama-running-archive.sh"; RECOVERY_CONSUMER_CLOSURE_HELPER="$SCRIPT_DIR/retire-ollama-consumer-closure.sh"; RECOVERY_IMAGE_FILESYSTEM_HELPER="$SCRIPT_DIR/retire-ollama-image-filesystem.pl"; RECOVERY_PROJECTOR_AUTH_HELPER="$SCRIPT_DIR/retire-ollama-projector-auth.sh"
[ -f "$RECOVERY_CONSUMERS_HELPER" ] && [ ! -L "$RECOVERY_CONSUMERS_HELPER" ] && [ -f "$RECOVERY_CONSUMER_MOUNTS_HELPER" ] && [ ! -L "$RECOVERY_CONSUMER_MOUNTS_HELPER" ] && [ -f "$RECOVERY_RUNNING_CONTAINER_HELPER" ] && [ ! -L "$RECOVERY_RUNNING_CONTAINER_HELPER" ] && [ -f "$RECOVERY_RUNNING_CONTAINER_VALIDATION_HELPER" ] && [ ! -L "$RECOVERY_RUNNING_CONTAINER_VALIDATION_HELPER" ] && [ -f "$RECOVERY_RUNNING_ARCHIVE_HELPER" ] && [ ! -L "$RECOVERY_RUNNING_ARCHIVE_HELPER" ] && [ -f "$RECOVERY_CONSUMER_CLOSURE_HELPER" ] && [ ! -L "$RECOVERY_CONSUMER_CLOSURE_HELPER" ] && [ -f "$RECOVERY_IMAGE_FILESYSTEM_HELPER" ] && [ ! -L "$RECOVERY_IMAGE_FILESYSTEM_HELPER" ] && [ -f "$RECOVERY_PROJECTOR_AUTH_HELPER" ] && [ ! -L "$RECOVERY_PROJECTOR_AUTH_HELPER" ] || review_required 'recovery consumer scanner helper missing'
RECOVERY_RECEIPTS_HELPER="$SCRIPT_DIR/retire-ollama-recovery-receipts.sh"; RECOVERY_PROCESS_FILES_HELPER="$SCRIPT_DIR/retire-ollama-process-files.sh"; RECOVERY_TEMP_ROOT_HELPER="$SCRIPT_DIR/retire-ollama-temp-root.sh"
[ -f "$RECOVERY_RECEIPTS_HELPER" ] && [ ! -L "$RECOVERY_RECEIPTS_HELPER" ] && [ -f "$RECOVERY_PROCESS_FILES_HELPER" ] && [ ! -L "$RECOVERY_PROCESS_FILES_HELPER" ] && [ -f "$RECOVERY_TEMP_ROOT_HELPER" ] && [ ! -L "$RECOVERY_TEMP_ROOT_HELPER" ] || review_required 'recovery helper missing'
if ! type source_loader_source >/dev/null 2>&1; then [ "$(/usr/bin/id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] || review_required 'source loader unavailable'; SOURCE_LOADER="$SCRIPT_DIR/retire-ollama-source-loader.sh"; [ -f "$SOURCE_LOADER" ] && [ ! -L "$SOURCE_LOADER" ] || review_required 'source loader missing'; . "$SOURCE_LOADER"; fi; source_loader_source "$RECOVERY_RECEIPTS_HELPER" || review_required 'recovery receipts source failed'; RECOVERY_RECEIPTS_LOADED_SHA=$SOURCE_LOADER_DIGEST; source_loader_source "$RECOVERY_PROCESS_FILES_HELPER" || review_required 'recovery process source failed'; RECOVERY_PROCESS_FILES_LOADED_SHA=$SOURCE_LOADER_DIGEST
recovery_dpkg_query() { dpkg-query "$@"; }
recovery_systemctl() { systemctl "$@"; }
recovery_docker() { docker --host "unix://$CANONICAL_DOCKER_SOCKET" "$@"; }
recovery_ps() { ps -ww -eo pid=,ppid=,args=; }
recovery_safe_int() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -gt 0 ] 2>/dev/null; }; recovery_nonnegative_int() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 0 ] 2>/dev/null; }
recovery_sha256() { /usr/bin/printf '%s\n' "$1" | /usr/bin/grep -Eq '^[0-9a-f]{64}$'; }
recovery_source_identity() { /usr/bin/printf '%s' "$1" | /usr/bin/grep -Eq '^[0-9a-f]{40}$' || return 1; [ "$(id -u)" -ne 0 ] || [ "$SCRIPT_DIR" = "$RECOVERY_SOURCE_ROOT/$1" ]; }
recovery_package_snapshot() {
  if package=$(recovery_dpkg_query -W "-f=\${db:Status-Abbrev} \${Version}" ollama 2>/dev/null); then
    status=$(printf '%.3s' "$package"); remainder=${package#???}; case "$remainder" in ' '*) version=${remainder# };; *) die 'invalid Ollama package status';; esac
    case "$status" in [uirph][nicUFhHWt]' '|[uirph][nicUFhHWt]R) :;; *) die 'invalid Ollama package status';; esac
    case "$version" in ''|*[[:space:]]*) die 'invalid Ollama package version';; esac
    case "$status" in ?i' ') :;; ?[nc]' ') /usr/bin/jq -cn '{name:"ollama",state:"absent",version:null}'; return;; *) /usr/bin/jq -cn --arg status "$status" --arg version "$version" '{name:"ollama",state:"partial",statusAbbrev:$status,version:$version}'; return;; esac
    [ -n "$version" ] || die 'empty Ollama package version'; /usr/bin/jq -cn --arg version "$version" '{name:"ollama",state:"present",version:$version}'
  else
    status=$?; [ "$status" -eq 1 ] || die "Ollama package query failed ($status)"
    /usr/bin/jq -cn '{name:"ollama",state:"absent",version:null}'
  fi
}
recovery_unit_snapshot() { name=$1
  if value=$(recovery_systemctl show "$name" -p LoadState -p UnitFileState -p ActiveState 2>/dev/null); then
    properties=$(temp_path); printf '%s\n' "$value" >"$properties" || die 'unit state serialization failed'; load_state=; unit_file_state=; active_state=; load_seen=0; unit_seen=0; active_seen=0
    while IFS='=' read -r key property || [ -n "$key$property" ]; do case "$key" in LoadState) [ "$load_seen" -eq 0 ] || die 'duplicate LoadState'; load_state=$property; load_seen=1;; UnitFileState) [ "$unit_seen" -eq 0 ] || die 'duplicate UnitFileState'; unit_file_state=$property; unit_seen=1;; ActiveState) [ "$active_seen" -eq 0 ] || die 'duplicate ActiveState'; active_state=$property; active_seen=1;; *) /bin/rm -f -- "$properties"; die 'unknown unit state property';; esac; done <"$properties"
    /bin/rm -f -- "$properties"; [ "$load_seen" -eq 1 ] && [ "$unit_seen" -eq 1 ] && [ "$active_seen" -eq 1 ] || die 'incomplete unit state'
    case "$load_state" in not-found) /usr/bin/jq -cn --arg name "$name" '{name:$name,state:"absent"}';; '') die 'empty unit LoadState';; *) /usr/bin/jq -cn --arg name "$name" --arg load "$load_state" --arg unit "$unit_file_state" --arg active "$active_state" --arg value "$(hash_text "$value")" '{name:$name,state:"present",loadState:$load,unitFileState:$unit,activeState:$active,stateSha256:$value}';; esac
  else status=$?; [ "$status" -eq 4 ] || die "unit state failed $name ($status)"; /usr/bin/jq -cn --arg name "$name" '{name:$name,state:"absent"}'; fi; }
recovery_systemd_properties() { name=$1; property=$2; out=$3; if recovery_systemctl show "$name" -p "$property" --value >"$out" 2>/dev/null; then return 0; else status=$?; fi; case "$status" in 1|4) : >"$out"; return "$status";; *) die "systemd property failed $name ($status)";; esac; }
recovery_surface() {
  class=$1; shift; out=$(temp_path); err=$(temp_path)
  status=0; "$@" >"$out" 2>"$err" || status=$?
  case "$class:$status" in
    *:0|systemd-definitions:1|systemd-definitions:4|systemd-timer-definitions:1|systemd-timer-definitions:4) :;;
    *) /bin/rm -f -- "$out" "$err"; die "recovery surface failed $class ($status)";;
  esac
  value=$(sha "$out"); error=$(sha "$err")
  RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "$class" --argjson status "$status" --arg value "$value" --arg error "$error" '$old + [{class:$class,exitStatus:$status,sha256:$value,stderrSha256:$error}]') || die "recovery surface serialization failed $class"
  case "$class" in
    systemd-consumers|reverse-proxy|compose-definitions|running-containers|container-definitions) record_consumers "$class" "$out" all || die "recovery consumer evidence failed $class";;
    current-crontab|running-processes) mode=matched; [ "$class" = current-crontab ] && mode=cron; record_consumers "$class" "$out" "$mode" || die "recovery consumer evidence failed $class";;
    system-crontab|system-cron-directory|user-crontab) record_consumers "$class" "$out" cron-unapproved || die "recovery consumer evidence failed $class";;
  esac
  /bin/rm -f -- "$out" "$err"
}
recovery_record_path() {
  class=$1; path=$2; optional=${3:-0}; retain=${4:-0}; RECOVERY_REFERENCE_SNAPSHOT=''; case "$path" in /*) :;; *) die 'non-absolute recovery reference';; esac
  [ ! -L "$path" ] || die 'symlinked recovery reference'
  if [ -e "$path" ]; then
    real=$(readlink -f -- "$path") || die 'recovery reference resolution failed'; [ "$real" = "$path" ] || die 'replaced recovery reference'
    raw=$(temp_path); { stat -c '%d:%i:%f:%s:%u:%g:%a' "$path"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$path"; } >"$raw" || { /bin/rm -f -- "$raw"; die 'recovery reference identity failed'; }
    identity=$(sha "$raw"); /bin/rm -f -- "$raw"; case "$(stat -c '%F' "$path")" in 'regular file')
      snapshot=$(temp_path); cat -- "$path" >"$snapshot" || { /bin/rm -f -- "$snapshot"; die 'recovery reference capture failed'; }; content=$(sha "$snapshot") || { /bin/rm -f -- "$snapshot"; die 'recovery reference digest failed'; }
      raw=$(temp_path); { [ ! -L "$path" ]; final_real=$(readlink -f -- "$path"); [ "$final_real" = "$real" ]; stat -c '%d:%i:%f:%s:%u:%g:%a' "$path"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$path"; } >"$raw" || { /bin/rm -f -- "$snapshot" "$raw"; review_required 'recovery reference changed during capture'; }; identity_after=$(sha "$raw"); /bin/rm -f -- "$raw"; content_after=$(sha "$path") || { /bin/rm -f -- "$snapshot"; review_required 'recovery reference changed during capture'; }; raw=$(temp_path); { [ ! -L "$path" ]; final_real=$(readlink -f -- "$path"); [ "$final_real" = "$real" ]; stat -c '%d:%i:%f:%s:%u:%g:%a' "$path"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$path"; } >"$raw" || { /bin/rm -f -- "$snapshot" "$raw"; review_required 'recovery reference changed during capture'; }; identity_final=$(sha "$raw"); /bin/rm -f -- "$raw"; [ "$identity" = "$identity_after" ] && [ "$identity" = "$identity_final" ] && [ "$content" = "$content_after" ] || { /bin/rm -f -- "$snapshot"; review_required 'recovery reference changed during capture'; }
      [ "$retain" -eq 1 ] && RECOVERY_REFERENCE_SNAPSHOT=$snapshot || /bin/rm -f -- "$snapshot";; *) content=$identity;; esac
    RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "$class" --arg path "$real" --arg identity "$identity" --arg content "$content" '$old + [{class:$class,state:"present",realPath:$path,identitySha256:$identity,contentSha256:$content}]') || die 'recovery reference serialization failed'
  else
    [ "$optional" -eq 1 ] || die 'required recovery reference missing'
    path_sha=$(hash_text "$path"); RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "$class" --arg path "$path_sha" '$old + [{class:$class,state:"absent",pathSha256:$path}]') || die 'recovery absent reference serialization failed'
  fi
}
recovery_environment_complete() { /usr/bin/printf '%s\n' "$1" | awk 'BEGIN{sq=0;dq=0;esc=0} {for(i=1;i<=length($0);i++){c=substr($0,i,1);if(esc){esc=0;continue};if(c=="\\"){esc=1;continue};if(c=="\""&&!sq)dq=!dq;else if(c=="\047"&&!dq)sq=!sq}} END{exit(sq||dq)}'; }
recovery_environment_continues() { /usr/bin/printf '%s\n' "$1" | awk '{n=0;for(i=length($0);i>0&&substr($0,i,1)=="\\";i--)n++;exit(n%2?0:1)}'; }
recovery_record_environment() {
  path=$1; optional=$2; recovery_record_path environment-file "$path" "$optional" 1; snapshot=${RECOVERY_REFERENCE_SNAPSHOT:-}; [ -n "$snapshot" ] || { [ ! -e "$path" ] && [ ! -L "$path" ] && return 0; die 'unsafe recovery EnvironmentFile'; }; pending=''
  while IFS= read -r line || [ -n "$line" ]; do [ -n "$pending" ] || { case "$line" in *[![:space:]]*) line=${line#"${line%%[![:space:]]*}"};; *) continue;; esac; case "$line" in '#'*|';'*) continue;; esac; }; pending=$pending$line; recovery_environment_continues "$line" && { pending=${pending%\\}; continue; }; recovery_environment_complete "$pending" && { case "$pending" in *=*) key=${pending%%=*}; value=${pending#*=};; *) /bin/rm -f -- "$snapshot"; die 'malformed recovery EnvironmentFile';; esac; case "$key" in ''|*[!A-Za-z_0-9]*|[0-9]*) /bin/rm -f -- "$snapshot"; die 'malformed recovery EnvironmentFile';; esac; case "$value" in \"*\") value=${value#\"}; value=${value%\"};; \'*\') value=${value#\'}; value=${value%\'};; esac; record_dependency "environment:$key" "$value" "$path"; pending=''; }; done <"$snapshot"; /bin/rm -f -- "$snapshot"; RECOVERY_REFERENCE_SNAPSHOT=''; [ -z "$pending" ] || die 'malformed recovery EnvironmentFile'
}
recovery_process_identity() { pid=$1; recovery_safe_int "$pid" || die 'invalid process pid'; cgroup="$RECOVERY_PROC_ROOT/$pid/cgroup"; namespace="$RECOVERY_PROC_ROOT/$pid/ns/pid"; [ -f "$cgroup" ] && [ ! -L "$cgroup" ] && [ -e "$namespace" ] || die "process identity unavailable $pid"; namespace_value=$(readlink -- "$namespace") || die "process namespace unavailable $pid"; cgroup_sha=$(sha "$cgroup") || die 'process cgroup digest failed'; namespace_sha=$(hash_text "$namespace_value") || die 'process namespace digest failed'; if ! recovery_sha256 "$cgroup_sha" || ! recovery_sha256 "$namespace_sha"; then die 'invalid process identity digest'; fi; printf '%s %s\n' "$cgroup_sha" "$namespace_sha"; }
recovery_is_scanner_ancestor() { case " ${RECOVERY_SCANNER_PID_SET:-} " in *" $1 "*) return 0;; *) return 1;; esac; }
recovery_has_ollama_reference() { /usr/bin/printf '%s\n' "$1" | /usr/bin/grep -qiE 'ollama|11434'; }
recovery_is_reviewed_scanner_command() { pid=$1; base=$2; command=$3; rest=$4; if [ "$base" = retire-ollama.sh ] && [ "$command" = "$SCRIPT_DIR/retire-ollama.sh" ]; then [ "$rest" = ' --recovery-scan' ]; else case "$base" in sh|dash|bash) [ "$rest" = " $SCRIPT_DIR/retire-ollama.sh --recovery-scan" ];; sudo) [ "$pid" = "${RECOVERY_SCANNER_DIRECT_PARENT:-}" ] && recovery_is_scanner_ancestor "$pid" || return 1; case "$command" in sudo|/usr/bin/sudo) :;; *) return 1;; esac; [ "$rest" = " $SCRIPT_DIR/retire-ollama.sh --recovery-scan" ] || return 1; executable="$RECOVERY_PROC_ROOT/$pid/exe"; [ -L "$executable" ] || return 1; real=$(readlink -f -- "$executable") || return 1; [ "$real" = /usr/bin/sudo ] && [ -f "$real" ] && [ -x "$real" ] && [ ! -L "$real" ];; *) return 1;; esac; fi; }
recovery_seen_flag() { case " ${2:-} " in *" $1 "*) return 0;; *) return 1;; esac; }
recovery_process_lifetime_marker() { pid=$1; identity=$(recovery_process_identity "$pid") || review_required 'process environment lifetime unavailable'; uid=$(awk '/^Uid:/{print $2; exit}' "$RECOVERY_PROC_ROOT/$pid/status"); start=$(sed 's/.*) //' "$RECOVERY_PROC_ROOT/$pid/stat" | awk '{print $20}'); { recovery_nonnegative_int "$uid" && recovery_safe_int "$start"; } || review_required 'process environment lifetime unavailable'; marker=$(hash_text "$identity:$uid:$start") || review_required 'process environment lifetime digest failed'; recovery_sha256 "$marker" || review_required 'invalid process environment lifetime digest'; printf '%s\n' "$marker"; }
recovery_process_environment_evidence() {
  pid=$1; process_root="$RECOVERY_PROC_ROOT/$pid"; [ -e "$process_root" ] || [ -L "$process_root" ] || { if [ "$(id -u)" -eq 0 ]; then /usr/bin/jq -cn '{state:"vanished"}'; else /usr/bin/jq -cn '{}'; fi; return; }; environment="$process_root/environ"
  if [ ! -f "$environment" ] || [ -L "$environment" ]; then if [ "$(id -u)" -ne 0 ] && [ "$RECOVERY_PROC_ROOT" != /proc ]; then /usr/bin/jq -cn '{}'; return; fi; [ ! -e "$process_root" ] && [ ! -L "$process_root" ] && { /usr/bin/jq -cn '{state:"vanished"}'; return; }; review_required 'process environment unavailable'; fi
  before=$(recovery_process_lifetime_marker "$pid") || { [ ! -e "$process_root" ] && [ ! -L "$process_root" ] && { /usr/bin/jq -cn '{state:"vanished"}'; return; }; review_required 'process environment lifetime unavailable'; }
  matches=$(temp_path); /usr/bin/perl -0ne 'print if /^(?:OLLAMA(?:_[A-Za-z0-9_]*)?)=/i || /(?:^|[^[:alnum:]_])(?:ollama|11434)(?:[^[:alnum:]_]|$)/i' "$environment" >"$matches" || { rm -f "$matches"; [ ! -e "$process_root" ] && [ ! -L "$process_root" ] && { /usr/bin/jq -cn '{state:"vanished"}'; return; }; review_required 'process environment scan failed'; }; [ -e "$process_root" ] || [ -L "$process_root" ] || { rm -f "$matches"; /usr/bin/jq -cn '{state:"vanished"}'; return; }; if [ -s "$matches" ]; then matched=$(sha "$matches") || { rm -f "$matches"; [ ! -e "$process_root" ] && [ ! -L "$process_root" ] && { /usr/bin/jq -cn '{state:"vanished"}'; return; }; review_required 'process environment match digest failed'; }; recovery_sha256 "$matched" || { rm -f "$matches"; review_required 'invalid process environment match digest'; }; else matched=''; fi
  after=$(recovery_process_lifetime_marker "$pid") || { rm -f "$matches"; [ ! -e "$process_root" ] && [ ! -L "$process_root" ] && { /usr/bin/jq -cn '{state:"vanished"}'; return; }; review_required 'process environment lifetime unavailable'; }; [ "$before" = "$after" ] || { rm -f "$matches"; review_required 'process environment lifetime changed'; }; rm -f "$matches"; /usr/bin/jq -cn --arg lifetime "$after" --arg matched "$matched" '{lifetimeSha256:$lifetime} + (if $matched == "" then {} else {matchingEnvironmentSha256:$matched} end)'; }
recovery_record_process_environment_consumer() { evidence=$1; digest=$(printf '%s\n' "$evidence" | /usr/bin/jq -er '.matchingEnvironmentSha256') || die 'invalid process environment evidence'; recovery_sha256 "$digest" || die 'invalid process environment evidence'; unknown=$(hash_text unknown) || die 'process environment dependency digest failed'; recovery_sha256 "$unknown" || die 'invalid process environment dependency digest'; deps=$(/usr/bin/jq -cn --argjson old "$deps" --arg value "$unknown" --arg source "$digest" '$old + [{"key-name":("running-processes:environment:" + $source),"endpoint-class":"unknown","normalized-value-sha256":$value,"source-path-sha256":$source,disposition:"consumer"}]') || die 'process environment dependency record failed'; consumer_evidence=$(/usr/bin/jq -cn --argjson old "$consumer_evidence" --arg sha "$digest" '$old + [{surface:"running-processes",classifiedPathSha256:$sha}]') || die 'process environment evidence record failed'; consumer_counts=$(/usr/bin/jq -cn --argjson old "$consumer_counts" '$old as $counts | [$counts[] | select(.surface == "running-processes")] as $running | if ($running | length) == 1 then $counts | map(if .surface == "running-processes" then .matchCount += 1 else . end) else error("invalid running process consumer inventory") end') || die 'process environment count record failed'; }
recovery_build_scanner_ancestors() {
  current=$RECOVERY_SELF_PID; hops=0; pids=''; entries='[]'; RECOVERY_SCANNER_DIRECT_PARENT=''
  while recovery_safe_int "$current" && [ "$hops" -lt 64 ]; do
    line=$(awk -v pid="$current" '$1 == pid { print; exit }' "$RECOVERY_PROCESS_FILE") || die 'scanner ancestry read failed'
    [ -n "$line" ] || die 'scanner ancestry missing'
    IFS=' ' read -r pid ppid args <<EOF
$line
EOF
    if [ "$pid" != "$current" ] || ! recovery_safe_int "$pid" || ! recovery_nonnegative_int "$ppid"; then die 'scanner ancestry pid binding failed'; fi
    identity=$(recovery_process_identity "$pid"); IFS=' ' read -r cgroup namespace extra <<EOF
$identity
EOF
    [ -z "${extra:-}" ] && [ -n "$cgroup" ] && [ -n "$namespace" ] || die 'scanner ancestry identity failed'
    ancestor_exe="$RECOVERY_PROC_ROOT/$pid/exe"; [ -L "$ancestor_exe" ] || review_required 'scanner ancestor executable missing'; ancestor_real=$(readlink -f -- "$ancestor_exe") || review_required 'scanner ancestor executable unresolved'; [ -x "$ancestor_real" ] && [ ! -L "$ancestor_real" ] || review_required 'scanner ancestor executable unsafe'
    ancestor_stat=$(stat -Lc '%d:%i:%u:%g:%a' "$ancestor_exe") || review_required 'scanner ancestor executable identity failed'; ancestor_uid=$(awk '/^Uid:/{print $2; exit}' "$RECOVERY_PROC_ROOT/$pid/status"); ancestor_start=$(sed 's/.*) //' "$RECOVERY_PROC_ROOT/$pid/stat" | awk '{print $20}')
    if ! recovery_nonnegative_int "$ancestor_uid" || ! recovery_safe_int "$ancestor_start"; then review_required 'scanner ancestor lifetime identity failed'; fi
    args_sha=$(hash_text "$args") || die 'scanner ancestry args digest failed'; executable_sha=$(sha "$ancestor_exe") || die 'scanner ancestry executable digest failed'; identity_sha=$(hash_text "$ancestor_stat") || die 'scanner ancestry identity digest failed'; if ! recovery_sha256 "$args_sha" || ! recovery_sha256 "$executable_sha" || ! recovery_sha256 "$identity_sha"; then die 'invalid scanner ancestry digest'; fi; entries=$(/usr/bin/jq -cn --argjson old "$entries" --arg pid "$pid" --arg ppid "$ppid" --arg args "$args_sha" --arg cgroup "$cgroup" --arg namespace "$namespace" --arg executable "$ancestor_real" --arg digest "$executable_sha" --arg identity "$identity_sha" --arg uid "$ancestor_uid" --arg start "$ancestor_start" '$old + [{pid:$pid,ppid:$ppid,argsSha256:$args,cgroupSha256:$cgroup,pidNamespaceSha256:$namespace,executable:{path:$executable,sha256:$digest,identitySha256:$identity,uid:$uid,startTime:$start}}]') || die 'scanner ancestry serialization failed'
    [ "$pid" != "$RECOVERY_SELF_PID" ] || RECOVERY_SCANNER_DIRECT_PARENT=$ppid; pids="$pids $pid"; [ "$pid" = 1 ] && break
    current=$ppid; hops=$((hops + 1))
  done
  RECOVERY_SCANNER_PID_SET=$pids; RECOVERY_SCANNER_ANCESTORS=$entries
}
recovery_process_executable() {
  pid=$1; expected=$2; kind=$3; exe="$RECOVERY_PROC_ROOT/$pid/exe"; [ -L "$exe" ] || review_required 'process executable link missing'
  observed=$(readlink -- "$exe") || review_required 'process executable target unavailable'; observed=${observed% (deleted)}
  case "$kind" in
    ollama)
      case "/${expected#/}/" in *'/../'*|*'/./'*|*'//'*) review_required 'process executable expectation path unsafe';; esac; case "$expected" in /*) :;; *) review_required 'process executable expectation path unsafe';; esac
      expected_path="$RECOVERY_PROC_ROOT/$pid/root$expected"
      expected_real=$(readlink -f -- "$expected_path") || review_required 'process executable expectation unresolved'
      expected_identity=$(stat -Lc '%d:%i:%u:%g:%a' "$expected_path") || review_required 'process executable expectation identity failed'
      observed_identity=$(stat -Lc '%d:%i:%u:%g:%a' "$exe") || review_required 'process executable identity failed'; [ "$expected_identity" = "$observed_identity" ] || review_required 'process executable mismatch'
      [ -n "$expected_real" ] || review_required 'process executable expectation unresolved'; real=$expected_real;;
    docker-proxy) real=$(readlink -f -- "$exe") || review_required 'process executable resolution failed'; case "$real" in /usr/bin/docker-proxy|/usr/libexec/docker/docker-proxy) :;; *) review_required 'unreviewed process executable path';; esac;;
    *) review_required 'unreviewed process executable path';;
  esac
  stat_value=$(stat -Lc '%d:%i:%u:%g:%a' "$exe") || review_required 'process executable identity failed'
  start_value=$(sed 's/.*) //' "$RECOVERY_PROC_ROOT/$pid/stat" | awk '{print $20}')
  uid_value=$(awk '/^Uid:/{print $2; exit}' "$RECOVERY_PROC_ROOT/$pid/status")
  if ! recovery_safe_int "$start_value" || ! recovery_nonnegative_int "$uid_value" || { [ "$kind" = docker-proxy ] && [ "$uid_value" != 0 ]; }; then review_required 'process executable lifetime identity failed'; fi
  digest=$(sha "$exe") || review_required 'process executable digest failed'; identity=$(hash_text "$stat_value") || review_required 'process executable identity digest failed'; if ! recovery_sha256 "$digest" || ! recovery_sha256 "$identity"; then review_required 'invalid process executable digest'; fi; observed_after=$(readlink -- "$exe") || review_required 'process executable target changed'; observed_after=${observed_after% (deleted)}; stat_after=$(stat -Lc '%d:%i:%u:%g:%a' "$exe") || review_required 'process executable identity changed'; start_after=$(sed 's/.*) //' "$RECOVERY_PROC_ROOT/$pid/stat" | awk '{print $20}'); uid_after=$(awk '/^Uid:/{print $2; exit}' "$RECOVERY_PROC_ROOT/$pid/status")
  if [ "$kind" = ollama ]; then expected_real_after=$(readlink -f -- "$expected_path") || review_required 'process executable expectation changed'; expected_identity_after=$(stat -Lc '%d:%i:%u:%g:%a' "$expected_path") || review_required 'process executable expectation changed'; [ "$expected_real" = "$expected_real_after" ] && [ "$expected_identity" = "$expected_identity_after" ] && [ "$expected_identity_after" = "$stat_after" ] || review_required 'process executable expectation changed'; fi
  [ "$observed" = "$observed_after" ] && [ "$stat_value" = "$stat_after" ] && [ "$start_value" = "$start_after" ] && [ "$uid_value" = "$uid_after" ] || review_required 'process executable changed during digest'
  /usr/bin/jq -cn --arg path "$observed" --arg real "$real" --arg digest "$digest" --arg identity "$identity" --arg uid "$uid_value" --arg start "$start_value" --arg expected "$expected" --arg kind "$kind" '{path:$path,realPath:$real,sha256:$digest,identitySha256:$identity,uid:$uid,startTime:$start,expected:$expected,kind:$kind}' || review_required 'process executable serialization failed'
}
recovery_proxy_ports_ok() {
  args=$1; ports=$2; proto=''; host_ip=''; host_port=''; container_ip=''; container_port=''; seen=''; set -f
  # shellcheck disable=SC2086 # Deliberate argv tokenization of ps output with globbing disabled.
  set -- $args
  set +f
  command=${1:-}; shift || return 1
  case "$command" in docker-proxy|*/docker-proxy) :;; *) return 1;; esac
  while [ "$#" -gt 0 ]; do
    key=$1; shift
    case "$key" in
      -proto=*) [ -z "$proto" ] || return 1; proto=${key#-proto=};;
      -host-ip=*) recovery_seen_flag host-ip "$seen" && return 1; seen="$seen host-ip"; host_ip=${key#-host-ip=};;
      -host-port=*) recovery_seen_flag host-port "$seen" && return 1; seen="$seen host-port"; host_port=${key#-host-port=};;
      -container-ip=*) recovery_seen_flag container-ip "$seen" && return 1; seen="$seen container-ip"; container_ip=${key#-container-ip=};;
      -container-port=*) recovery_seen_flag container-port "$seen" && return 1; seen="$seen container-port"; container_port=${key#-container-port=};;
      -proto|-host-ip|-host-port|-container-ip|-container-port) [ "$#" -gt 0 ] || return 1; value=$1; shift; case "$key" in -proto) [ -z "$proto" ] || return 1; proto=$value;; -host-ip) recovery_seen_flag host-ip "$seen" && return 1; seen="$seen host-ip"; host_ip=$value;; -host-port) recovery_seen_flag host-port "$seen" && return 1; seen="$seen host-port"; host_port=$value;; -container-ip) recovery_seen_flag container-ip "$seen" && return 1; seen="$seen container-ip"; container_ip=$value;; -container-port) recovery_seen_flag container-port "$seen" && return 1; seen="$seen container-port"; container_port=$value;; esac;;
      *) return 1;;
    esac
  done
  [ -n "$host_port" ] && [ -n "$container_port" ] || return 1
  if [ "$host_port" != 11434 ] && [ "$container_port" != 11434 ]; then return 2; fi
  [ "$proto" = tcp ] && [ "$host_ip" = 127.0.0.1 ] && [ "$host_port" = 11434 ] && [ -n "$container_ip" ] && [ "$container_port" = 11434 ] || return 1
  /usr/bin/jq -e --arg hostIp "$host_ip" --arg hostPort "$host_port" --arg containerIp "$container_ip" '
    (any((.NetworkSettings.Ports["11434/tcp"] // [])[]?; ((.HostPort // "") == $hostPort) and ((.HostIp // "0.0.0.0") == $hostIp))) and
    (any((.NetworkSettings.Networks // {})[]?; (.IPAddress // "") == $containerIp))
  ' "$ports" >/dev/null 2>&1
}
recovery_container_ports_ok() {
  ports=$1; /usr/bin/jq -e '(any((.HostConfig.PortBindings["11434/tcp"] // [])[]?; ((.HostPort // "") == "11434") and ((.HostIp // "0.0.0.0") == "127.0.0.1"))) and (any((.NetworkSettings.Ports["11434/tcp"] // [])[]?; ((.HostPort // "") == "11434") and ((.HostIp // "0.0.0.0") == "127.0.0.1"))) and (any((.NetworkSettings.Networks // {})[]?; (.IPAddress // "") != ""))' "$ports" >/dev/null 2>&1
}
recovery_process_snapshot() {
  container_pid=$1; container_cgroup=$2; container_namespace=$3; ports=$4; processes=$5
  RECOVERY_PROCESS_FILE=$processes; RECOVERY_SELF_PID=${RECOVERY_SELF_PID:-$$}; RECOVERY_SCANNER_PID_SET=''; RECOVERY_SCANNER_ANCESTORS='[]'; RECOVERY_CONTAINER_PROCESS_UID=''
  if awk -v pid="$RECOVERY_SELF_PID" '$1 == pid { found=1 } END { exit(found ? 0 : 1) }' "$processes"; then recovery_build_scanner_ancestors; fi
  recovery_socket_snapshot "$container_pid" "$container_cgroup" "$container_namespace" "$ports" "$processes"
  entries='[]'; container_count=0; proxy_count=0; container_pid_seen=0
  while IFS=' ' read -r pid ppid args || [ -n "$pid$ppid$args" ]; do
    [ -n "$pid" ] || continue
    if ! recovery_safe_int "$pid" || ! recovery_nonnegative_int "$ppid"; then review_required 'invalid process pid binding'; fi; environment=$(recovery_process_environment_evidence "$pid"); environment_state=$(printf '%s\n' "$environment" | /usr/bin/jq -r '.state // "present"') || review_required 'invalid process environment evidence'; [ "$environment_state" = vanished ] && continue; [ "$environment_state" = present ] || review_required 'invalid process environment evidence'; environment_match=$(printf '%s\n' "$environment" | /usr/bin/jq -r '.matchingEnvironmentSha256 // empty') || review_required 'invalid process environment evidence'
    command=${args%% *}; rest=${args#"$command"}; base=${command##*/}; class=''
    case "$base" in
      ollama) case "$rest" in ' serve'|' serve '*) class=ollama-process;; ' runner'|' runner '*) class=ollama-process;; *) review_required 'unsupported Ollama process';; esac;;
      docker-proxy) class=docker-proxy;;
      *)
        if recovery_has_ollama_reference "$args" || [ -n "$environment_match" ]; then if recovery_is_scanner_ancestor "$pid" && recovery_is_reviewed_scanner_command "$pid" "$base" "$command" "$rest"; then :; else [ -z "$environment_match" ] || recovery_record_process_environment_consumer "$environment"; review_required 'foreign Ollama process refused'; fi; continue; fi; file_evidence=$(recovery_process_file_evidence "$pid"); file_state=$(printf '%s\n' "$file_evidence" | /usr/bin/jq -r '.state // "present"') || review_required 'invalid process file evidence'; [ "$file_state" = vanished ] && continue; if recovery_process_files_match "$file_evidence"; then if recovery_is_scanner_ancestor "$pid" && recovery_is_reviewed_scanner_command "$pid" "$base" "$command" "$rest"; then :; else recovery_record_process_file_consumer "$file_evidence"; review_required 'foreign Ollama process refused'; fi; fi
        continue;;
    esac
    identity=$(recovery_process_identity "$pid") || review_required 'process identity unavailable'; IFS=' ' read -r cgroup namespace extra <<EOF
$identity
EOF
    [ -z "${extra:-}" ] && [ -n "$cgroup" ] && [ -n "$namespace" ] || review_required 'invalid process identity'
    binding='container'
    if [ "$class" = docker-proxy ]; then
      if recovery_proxy_ports_ok "$args" "$ports"; then :; else status=$?; [ "$status" -eq 2 ] && continue; review_required 'Docker proxy is not bound to the reviewed container'; fi
      binding='container-port-11434/tcp'; proxy_count=$((proxy_count + 1))
    else
      [ "$cgroup" = "$container_cgroup" ] && [ "$namespace" = "$container_namespace" ] || review_required 'foreign Ollama process refused'; [ "$pid" = "$container_pid" ] && container_pid_seen=1
      container_count=$((container_count + 1))
    fi
    if [ "$class" = docker-proxy ]; then executable=$(recovery_process_executable "$pid" docker-proxy docker-proxy) || review_required 'process executable unavailable'; else executable=$(recovery_process_executable "$pid" "$RECOVERY_CONTAINER_COMMAND_PATH" ollama) || review_required 'process executable unavailable'; process_uid=$(/usr/bin/jq -er .uid <<EOF
$executable
EOF
) || review_required 'container process uid unavailable'; if [ -z "$process_uid" ] || ! recovery_nonnegative_int "$process_uid"; then review_required 'container process uid unavailable'; fi; if [ -z "$RECOVERY_CONTAINER_PROCESS_UID" ]; then RECOVERY_CONTAINER_PROCESS_UID=$process_uid; elif [ "$RECOVERY_CONTAINER_PROCESS_UID" != "$process_uid" ]; then review_required 'container process uid drift'; fi; fi
    args_sha=$(hash_text "$args") || review_required 'process args digest failed'; recovery_sha256 "$args_sha" || review_required 'invalid process args digest'; entries=$(/usr/bin/jq -cn --argjson old "$entries" --argjson executable "$executable" --argjson environment "$environment" --arg pid "$pid" --arg ppid "$ppid" --arg class "$class" --arg cgroup "$cgroup" --arg namespace "$namespace" --arg binding "$binding" --arg args "$args_sha" '$old + ([{pid:$pid,ppid:$ppid,class:$class,cgroupSha256:$cgroup,pidNamespaceSha256:$namespace,binding:$binding,executable:$executable,argsSha256:$args}] | if ($environment.matchingEnvironmentSha256? // "") == "" then . else .[0] += {environmentEvidence:$environment} end)') || die 'process receipt serialization failed'
  done <"$processes"
  [ "$container_count" -gt 0 ] || review_required 'incomplete reviewed Ollama process set'; [ "$container_pid_seen" -eq 1 ] || review_required 'inspected container process missing'; [ "$proxy_count" -gt 0 ] || recovery_container_ports_ok "$ports" || review_required 'published Ollama binding is not loopback-bound'
  /usr/bin/jq -cn --arg pid "$container_pid" --arg cgroup "$container_cgroup" --arg namespace "$container_namespace" --arg uid "${RECOVERY_CONTAINER_PROCESS_UID:-}" --arg socketDigest "$RECOVERY_SOCKET_SNAPSHOT_SHA" --argjson entries "$entries" --argjson ancestors "${RECOVERY_SCANNER_ANCESTORS:-[]}" --argjson listeners "$RECOVERY_LISTENING_SOCKETS" --argjson containers "$container_count" --argjson proxies "$proxy_count" '{containerPid:$pid,containerCgroupSha256:$cgroup,containerPidNamespaceSha256:$namespace,containerUid:$uid,matchingProcesses:$entries,listeningSockets:$listeners,socketSnapshotSha256:$socketDigest,scannerAncestors:$ancestors,containerProcessCount:$containers,proxyProcessCount:$proxies}'
}
recovery_cron_snapshot() {
  cron=$1; [ -f "$cron" ] && [ ! -L "$cron" ] || die 'unsafe recovery crontab'
  lines=$(temp_path); grouped=$(temp_path); entries='[]'; count=0
  while IFS= read -r line || [ -n "$line" ]; do hash_text "$line" >>"$lines" || die 'cron line digest failed'; count=$((count + 1)); done <"$cron"
  sort "$lines" | uniq -c >"$grouped" || { rm -f "$lines" "$grouped"; die 'cron digest grouping failed'; }
  while IFS=' ' read -r number digest || [ -n "$number$digest" ]; do [ -n "$digest" ] || continue; entries=$(/usr/bin/jq -cn --argjson old "$entries" --arg sha "$digest" --argjson count "$number" '$old + [{sha256:$sha,count:$count}]') || die 'cron receipt serialization failed'; done <"$grouped"
  whole=$(sha "$cron"); rm -f "$lines" "$grouped"
  /usr/bin/jq -cn --arg whole "$whole" --argjson count "$count" --argjson entries "$entries" '{wholeSha256:$whole,lineCount:$count,lines:$entries}'
}
recovery_model_snapshot() {
  if [ ! -e "$STORE" ] && [ ! -L "$STORE" ]; then /usr/bin/jq -cn '{state:"absent"}'; return; fi
  [ -d "$STORE" ] && [ ! -L "$STORE" ] || die 'unsafe recovery model store'
  real=$(readlink -f -- "$STORE") || die 'cannot resolve recovery model store'; [ "$real" = "$STORE" ] || die 'replaced recovery model store'
  parent=$(dirname "$STORE"); parent_real=$(readlink -f -- "$parent") || die 'cannot resolve recovery model parent'; [ "$parent_real" = "$parent" ] || die 'replaced recovery model parent'
  [ ! -L "$parent" ] || die 'unsafe recovery model parent'
  parent_identity=$(stat -c '%d:%i:%u:%g:%a' "$parent") || die 'recovery model parent identity failed'; IFS=: read -r parent_device parent_inode parent_uid parent_gid parent_mode <<EOF
$parent_identity
EOF
  case "$parent_mode" in ''|*[!0-7]*) die 'invalid recovery model parent mode';; esac; [ $((0$parent_mode & 022)) -eq 0 ] || die 'writable recovery model parent'
  identity=$(stat -c '%d:%i:%u:%g:%a' "$STORE") || die 'recovery model identity failed'; IFS=: read -r device inode uid gid mode <<EOF
$identity
EOF
  listing=$(temp_path); sorted=$(temp_path); mount=$(temp_path)
  find "$STORE" -xdev -type f -printf '%y:%m:%s:%T@:%p:' -exec sha256sum -- {} \; >"$listing" && find "$STORE" -xdev ! -type f -printf '%y:%m:%s:%T@:%p\n' >>"$listing" || die 'recovery model listing failed'; sort "$listing" >"$sorted" || die 'recovery model sort failed'; tree=$(sha "$sorted")
  findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$STORE" >"$mount" || die 'recovery model mount scan failed'; mount_sha=$(sha "$mount"); rm -f "$listing" "$sorted" "$mount"
  /usr/bin/jq -cn --arg path "$real" --arg parent "$parent_real" --arg device "$device" --arg inode "$inode" --arg uid "$uid" --arg gid "$gid" --arg mode "$mode" --arg pdevice "$parent_device" --arg pinode "$parent_inode" --arg puid "$parent_uid" --arg pgid "$parent_gid" --arg pmode "$parent_mode" --arg mount "$mount_sha" --arg tree "$tree" '{realPath:$path,parent:{realPath:$parent,device:$pdevice,inode:$pinode,uid:$puid,gid:$pgid,mode:$pmode},device:$device,inode:$inode,mountSha256:$mount,treeSha256:$tree,owner:{uid:$uid,gid:$gid,mode:$mode}}'
}
recovery_container_snapshot() {
  json=$(temp_path); error=$(temp_path)
# shellcheck disable=SC2153 # CONTAINER is defined by the sourced entrypoint.
  if recovery_docker inspect -f '{{json .}}' "$CONTAINER" >"$json" 2>"$error"; then :; else
    status=$?; if [ "$status" -eq 1 ] && grep -Fqx "Error: No such object: $CONTAINER" "$error"; then
      listed=$(temp_path); stable=$(temp_path); fresh=$(temp_path); recovery_docker ps -a --no-trunc --format '{{.ID}} {{.Names}}' >"$listed" 2>/dev/null || { rm -f "$json" "$error" "$listed" "$stable" "$fresh"; die 'recovery container absence verification failed'; }; sort -u "$listed" >"$stable" || { rm -f "$json" "$error" "$listed" "$stable" "$fresh"; die 'recovery container absence verification failed'; }; awk -v name="$CONTAINER" 'NF != 2 || $1 !~ /^[0-9a-f]{64}$/ || $2 == "" { invalid=1 } $2 == name { found=1 } END { exit(invalid ? 1 : (found ? 2 : 0)) }' "$stable"; status=$?; [ "$status" -eq 0 ] || { rm -f "$json" "$error" "$listed" "$stable" "$fresh"; [ "$status" -eq 2 ] && review_required 'recovery container changed during absence verification'; die 'invalid recovery container absence inventory'; }; if recovery_docker ps -a --no-trunc --format '{{.ID}} {{.Names}}' >"$fresh" 2>/dev/null && sort -u "$fresh" >"$listed" && cmp -s "$stable" "$listed"; then :; else rm -f "$json" "$error" "$listed" "$stable" "$fresh"; review_required 'recovery container changed during absence verification'; fi
      rm -f "$json" "$error" "$listed" "$stable" "$fresh"; RECOVERY_CONTAINER_STATE=absent; /usr/bin/jq -cn '{name:"ollama-loopback",state:"absent"}'; return
    fi
    rm -f "$json" "$error"; die "recovery container inspection failed ($status)"
  fi; rm -f "$error"
  /usr/bin/jq -e 'type == "object" and .Name == "/ollama-loopback" and (.Id|type == "string" and test("^[0-9a-f]{64}$")) and (.Image|type == "string" and test("^sha256:[0-9a-f]{64}$")) and (.Path|type == "string" and test("^/[A-Za-z0-9._+@/-]*ollama$")) and (.Path|split("/")|.[0] == "" and (.[1:]|length > 0) and all(.[1:][]; . != "" and . != "." and . != "..")) and (.State|type == "object") and (.State.Running|type == "boolean") and (.State.Pid|type == "number" and floor == . and . >= 0) and ((.State.Running and .State.Pid > 0) or ((.State.Running|not) and .State.Pid == 0))' "$json" >/dev/null || { rm -f "$json"; die 'invalid recovery container snapshot'; }
  id=$(/usr/bin/jq -er '.Id' "$json"); image=$(/usr/bin/jq -er '.Image' "$json"); path=$(/usr/bin/jq -er '.Path' "$json"); pid=$(/usr/bin/jq -er '.State.Pid' "$json"); running=$(/usr/bin/jq -r '.State.Running' "$json")
  config_file=$(temp_path); /usr/bin/jq -S -c '{Config,HostConfig,Mounts,Networks:.NetworkSettings.Networks}' "$json" >"$config_file" || die 'recovery container config failed'; config=$(sha "$config_file"); rm -f "$config_file"
  ports_file=$(temp_path); /usr/bin/jq -S '{HostConfig:{PortBindings:.HostConfig.PortBindings},NetworkSettings:{Ports:.NetworkSettings.Ports,Networks:.NetworkSettings.Networks}}' "$json" >"$ports_file" || die 'recovery container ports failed'; ports_sha=$(sha "$ports_file")
  cgroup=; namespace=; state=stopped
  if [ "$running" = true ]; then identity=$(recovery_process_identity "$pid"); IFS=' ' read -r cgroup namespace extra <<EOF
$identity
EOF
    [ -z "${extra:-}" ] && [ -n "$cgroup" ] && [ -n "$namespace" ] || die 'invalid container process identity'; state=running
  fi
  RECOVERY_CONTAINER_STATE=$state RECOVERY_CONTAINER_ID=$id RECOVERY_CONTAINER_NAME=/ollama-loopback RECOVERY_CONTAINER_CONFIG_SHA=$config RECOVERY_CONTAINER_COMMAND_PATH=$path RECOVERY_CONTAINER_PID=$pid RECOVERY_CONTAINER_CGROUP=$cgroup RECOVERY_CONTAINER_NAMESPACE=$namespace RECOVERY_CONTAINER_PORTS_FILE=$ports_file
  /usr/bin/jq -cn --arg id "$id" --arg image "$image" --arg path "$path" --arg pid "$pid" --arg state "$state" --arg config "$config" --arg ports "$ports_sha" '{name:"ollama-loopback",state:$state,fullId:$id,imageId:$image,commandPath:$path,pid:$pid,configSha256:$config,portsSha256:$ports}'
  rm -f "$json"
}
recovery_terminal_container_snapshot() { json=$(temp_path); error=$(temp_path); if recovery_docker inspect -f '{{json .}}' "$CONTAINER" >"$json" 2>"$error"; then status=0; else status=$?; fi; if [ "${RECOVERY_CONTAINER_STATE:-}" = absent ]; then [ "$status" -ne 0 ] || { /bin/rm -f -- "$json" "$error"; review_required 'recovery container changed before receipt publication'; }; [ "$status" -eq 1 ] && [ ! -s "$json" ] && grep -Fqx "Error: No such object: $CONTAINER" "$error" || { /bin/rm -f -- "$json" "$error"; review_required 'recovery container terminal verification failed'; }; else config=$(temp_path); if [ "$status" -eq 0 ] && /usr/bin/jq -e --arg id "$RECOVERY_CONTAINER_ID" --arg name "$RECOVERY_CONTAINER_NAME" --arg state "$RECOVERY_CONTAINER_STATE" --arg pid "$RECOVERY_CONTAINER_PID" 'type == "object" and .Name == $name and .Id == $id and (.State|type == "object") and (.State.Running == ($state == "running")) and (.State.Pid|type == "number" and floor == . and . >= 0 and tostring == $pid)' "$json" >/dev/null && /usr/bin/jq -S -c '{Config,HostConfig,Mounts,Networks:.NetworkSettings.Networks}' "$json" >"$config" && actual=$(sha "$config") && [ "$actual" = "$RECOVERY_CONTAINER_CONFIG_SHA" ]; then :; else /bin/rm -f -- "$json" "$error" "$config"; review_required 'recovery container changed before receipt publication'; fi; /bin/rm -f -- "$config"; fi; /bin/rm -f -- "$json" "$error"; }
recovery_record_environment_property() {
  file=$1; set -f; tokens=$(cat "$file") || die 'recovery EnvironmentFiles read failed'; # shellcheck disable=SC2086
  set -- $tokens; set +f
  while [ "$#" -gt 0 ]; do item=$1; shift; optional=0; case "$item" in -/*) optional=1; item=${item#-};; /*) :;; *) die 'malformed recovery EnvironmentFiles path';; esac; [ "$#" -gt 0 ] || die 'missing recovery EnvironmentFiles annotation'; annotation=$1; shift; case "$annotation" in '(ignore_errors=no)') [ "$optional" -eq 0 ] || die 'recovery EnvironmentFiles optionality drift';; '(ignore_errors=yes)') optional=1;; *) die 'unknown recovery EnvironmentFiles annotation';; esac; recovery_record_environment "$item" "$optional"; done
}; recovery_collect_crontab() { target=$1; if crontab -u "$OWNER" -l >"$target" 2>/dev/null; then :; else status=$?; [ "$status" -eq 1 ] || die 'recovery crontab scan failed'; : >"$target"; fi; load_cron_inventory_helper; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); cron_inventory_collect_external "$RECOVERY_EXTERNAL_CRON_SOURCES"; }
recovery_record_external_cron_sources() { manifest=${RECOVERY_EXTERNAL_CRON_SOURCES:-}; [ -f "$manifest" ] && [ ! -L "$manifest" ] || die 'recovery cron inventory missing'; load_consumer_scanners; manifest_captured=$(consumer_snapshot "$manifest") || die 'unsafe recovery cron inventory manifest'; manifest_snapshot=${manifest_captured%%|*}; manifest_identity=${manifest_captured#*|}; while IFS="$(printf '\t')" read -r kind account path || [ -n "$kind$account$path" ]; do case "$kind" in system) class='system-crontab';; system-directory) class='system-cron-directory';; user) class='user-crontab';; *) die 'invalid recovery cron inventory entry';; esac; [ -n "$path" ] || die 'invalid recovery cron inventory entry'; recovery_record_path "$class" "$path" 0 1; captured=$RECOVERY_REFERENCE_SNAPSHOT; recovery_surface "$class" cat "$captured"; records=$RECOVERY_RECORDS; cron_inventory_record_wrapper_consumers "$class" "$kind" "$path" "$captured" || { rm -f "$captured"; die 'unsafe recovery cron command target'; }; RECOVERY_RECORDS=$records; rm -f "$captured"; RECOVERY_REFERENCE_SNAPSHOT=''; done <"$manifest_snapshot"; consumer_canonical_regular "$manifest" >/dev/null && [ "$manifest_identity" = "$(consumer_source_identity "$manifest")" ] || { rm -f "$manifest_snapshot"; die 'recovery cron inventory manifest changed'; }; rm -f "$manifest_snapshot"; }; recovery_collect_systemd() {
# shellcheck disable=SC2153 # UNIT is defined by the sourced entrypoint.
  recovery_surface systemd-definitions recovery_systemctl cat "$UNIT"
# shellcheck disable=SC2153 # TIMER is defined by the sourced entrypoint.
  recovery_surface systemd-timer-definitions recovery_systemctl cat "$TIMER"
  recovery_surface systemd-consumers scan_systemd_consumers
  for name in "$UNIT" "$TIMER"; do for property in FragmentPath DropInPaths EnvironmentFiles; do
      out=$(temp_path); if recovery_systemd_properties "$name" "$property" "$out"; then status=0; else status=$?; fi
      value=$(sha "$out")
      RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "systemd-$property" --arg name "$name" --argjson status "$status" --arg value "$value" '$old + [{class:$class,unit:$name,exitStatus:$status,sha256:$value}]') || die "recovery systemd property serialization failed $name $property"
      if [ "$status" -eq 0 ]; then
        case "$property" in
          FragmentPath) path=$(cat "$out"); [ -z "$path" ] || recovery_record_path systemd-fragment "$path" 0;;
          DropInPaths) tokens=$(temp_path); awk '{ for (i=1; i<=NF; i++) print $i }' "$out" >"$tokens"; while IFS= read -r path || [ -n "$path" ]; do [ -z "$path" ] || recovery_record_path systemd-drop-in "$path" 0; done <"$tokens"; rm -f "$tokens";;
          EnvironmentFiles) recovery_record_environment_property "$out";;
        esac
      fi
      rm -f "$out"; done
  done; :
}
recovery_collect_mutable_consumers() { cron=$1; output=$2; recovery_collect_crontab "$cron"; recovery_collect_systemd; recovery_surface reverse-proxy scan_nginx_definitions; recovery_surface compose-definitions scan_compose_definitions; recovery_surface current-crontab cat "$cron"; recovery_record_external_cron_sources; RECOVERY_MUTABLE_MODEL=$(recovery_model_snapshot); RECOVERY_MUTABLE_CRON=$(recovery_cron_snapshot "$cron"); /usr/bin/jq -S -n --argjson records "$RECOVERY_RECORDS" --argjson dependencies "$deps" --argjson counts "$consumer_counts" --argjson evidence "$consumer_evidence" --argjson model "$RECOVERY_MUTABLE_MODEL" --argjson cron "$RECOVERY_MUTABLE_CRON" '{surfaces:$records,dependencies:$dependencies,consumerCounts:$counts,consumerEvidence:$evidence,model:$model,crontab:$cron}' >"$output" || die 'recovery mutable consumer serialization failed'; }
recovery_terminal_mutable_consumers() { terminal_mutable_expected=$1; saved_records=$RECOVERY_RECORDS; saved_deps=$deps; saved_counts=$consumer_counts; saved_evidence=$consumer_evidence; saved_external=${RECOVERY_EXTERNAL_CRON_SOURCES:-}; RECOVERY_RECORDS='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; final_cron=$(temp_path); final_snapshot=$(temp_path); recovery_collect_mutable_consumers "$final_cron" "$final_snapshot"; final_external=${RECOVERY_EXTERNAL_CRON_SOURCES:-}; cmp -s "$terminal_mutable_expected" "$final_snapshot" || review_required 'recovery mutable consumer inventory changed before receipt publication'; rm -f "$final_cron" "$final_snapshot" "$final_external"; RECOVERY_RECORDS=$saved_records; deps=$saved_deps; consumer_counts=$saved_counts; consumer_evidence=$saved_evidence; RECOVERY_EXTERNAL_CRON_SOURCES=$saved_external; }
recovery_collect_container_consumers() { target=$1; container_saved_records=$RECOVERY_RECORDS; container_saved_deps=$deps; container_saved_counts=$consumer_counts; container_saved_evidence=$consumer_evidence; RECOVERY_RECORDS='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; recovery_surface container-definitions scan_container_definitions; recovery_surface running-containers scan_running_containers; /usr/bin/jq -S -n --argjson records "$RECOVERY_RECORDS" --argjson dependencies "$deps" --argjson counts "$consumer_counts" --argjson evidence "$consumer_evidence" '{surfaces:$records,dependencies:$dependencies,consumerCounts:$counts,consumerEvidence:$evidence}' >"$target" || die 'recovery container consumer serialization failed'; container_records=$RECOVERY_RECORDS; container_deps=$deps; container_counts=$consumer_counts; container_evidence=$consumer_evidence; RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$container_saved_records" --argjson new "$container_records" '$old + $new') || die 'recovery container surface merge failed'; deps=$(/usr/bin/jq -cn --argjson old "$container_saved_deps" --argjson new "$container_deps" '$old + $new') || die 'recovery container dependency merge failed'; consumer_counts=$(/usr/bin/jq -cn --argjson old "$container_saved_counts" --argjson new "$container_counts" '$old + $new') || die 'recovery container count merge failed'; consumer_evidence=$(/usr/bin/jq -cn --argjson old "$container_saved_evidence" --argjson new "$container_evidence" '$old + $new') || die 'recovery container evidence merge failed'; }
recovery_terminal_container_consumers() { expected=$1; terminal_container_saved_records=$RECOVERY_RECORDS; terminal_container_saved_deps=$deps; terminal_container_saved_counts=$consumer_counts; terminal_container_saved_evidence=$consumer_evidence; final_container_consumers=$(temp_path); recovery_collect_container_consumers "$final_container_consumers"; cmp -s "$expected" "$final_container_consumers" || review_required 'recovery container consumer inventory changed before receipt publication'; rm -f "$final_container_consumers"; RECOVERY_RECORDS=$terminal_container_saved_records; deps=$terminal_container_saved_deps; consumer_counts=$terminal_container_saved_counts; consumer_evidence=$terminal_container_saved_evidence; }
recovery_collect_processes() { processes=$1; recovery_ps >"$processes" || die 'recovery process scan failed'; recovery_surface running-processes cat "$processes"; }; recovery_terminal_process_snapshot() { processes=$1; prior=$2; recovery_ps >"$processes" || die 'recovery process scan failed'; case "${RECOVERY_CONTAINER_STATE:-}" in absent|stopped) final=$(recovery_absent_process_snapshot "$processes");; running) final=$(recovery_process_snapshot "$RECOVERY_CONTAINER_PID" "$RECOVERY_CONTAINER_CGROUP" "$RECOVERY_CONTAINER_NAMESPACE" "$RECOVERY_CONTAINER_PORTS_FILE" "$processes");; *) die 'invalid recovery container state';; esac; before=$(printf '%s\n' "$prior" | /usr/bin/jq -S -c .) && after=$(printf '%s\n' "$final" | /usr/bin/jq -S -c .) && [ "$before" = "$after" ] || review_required 'recovery process or socket inventory changed before receipt publication'; }
recovery_absent_process_snapshot() { processes=$1; RECOVERY_PROCESS_FILE=$processes; RECOVERY_SELF_PID=${RECOVERY_SELF_PID:-$$}; RECOVERY_SCANNER_PID_SET=''; if awk -v pid="$RECOVERY_SELF_PID" '$1 == pid { found=1 } END { exit(found ? 0 : 1) }' "$processes"; then recovery_build_scanner_ancestors; fi; recovery_socket_snapshot '' '' '' '' "$processes"; while IFS=' ' read -r pid ppid args || [ -n "$pid$ppid$args" ]; do [ -n "$pid" ] || continue; environment=$(recovery_process_environment_evidence "$pid"); environment_state=$(printf '%s\n' "$environment" | /usr/bin/jq -r '.state // "present"') || review_required 'invalid process environment evidence'; [ "$environment_state" = vanished ] && continue; [ "$environment_state" = present ] || review_required 'invalid process environment evidence'; command=${args%% *}; rest=${args#"$command"}; base=${command##*/}; case "$base" in ollama) review_required 'foreign Ollama process remains after container removal';; esac; environment_match=$(printf '%s\n' "$environment" | /usr/bin/jq -r '.matchingEnvironmentSha256 // empty') || review_required 'invalid process environment evidence'; if recovery_has_ollama_reference "$args" || [ -n "$environment_match" ]; then if recovery_is_scanner_ancestor "$pid" && recovery_is_reviewed_scanner_command "$pid" "$base" "$command" "$rest"; then :; else [ -z "$environment_match" ] || recovery_record_process_environment_consumer "$environment"; review_required 'foreign Ollama process remains after container removal'; fi; continue; fi; file_evidence=$(recovery_process_file_evidence "$pid"); file_state=$(printf '%s\n' "$file_evidence" | /usr/bin/jq -r '.state // "present"') || review_required 'invalid process file evidence'; [ "$file_state" = vanished ] && continue; if recovery_process_files_match "$file_evidence"; then if recovery_is_scanner_ancestor "$pid" && recovery_is_reviewed_scanner_command "$pid" "$base" "$command" "$rest"; then :; else recovery_record_process_file_consumer "$file_evidence"; review_required 'foreign Ollama process remains after container removal'; fi; fi; done <"$processes"; /usr/bin/jq -cn --arg socketDigest "$RECOVERY_SOCKET_SNAPSHOT_SHA" --argjson listeners "$RECOVERY_LISTENING_SOCKETS" '{state:"absent",matchingProcesses:[],listeningSockets:$listeners,socketSnapshotSha256:$socketDigest}'; }
recovery_scan() { root; init_temp_root; trap 'cleanup_temp' EXIT HUP INT TERM; assert_docker_socket; RECOVERY_SELF_PID=$$; RECOVERY_CONTAINER_PORTS_FILE=''
  if [ "$(id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] && [ -n "${RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA:-}" ]; then RECOVERY_SOURCE_SHA=$RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA; fi
  recovery_source_identity "$RECOVERY_SOURCE_SHA" || die 'invalid recovery source identity'
  RECOVERY_RECORDS='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'
  snapshot=$(temp_path); cron=$(temp_path); processes=$(temp_path); container=$(temp_path); mutable=$(temp_path); containers=$(temp_path)
  recovery_collect_mutable_consumers "$cron" "$mutable"
  recovery_collect_container_consumers "$containers"
  recovery_container_snapshot >"$container"
  recovery_collect_processes "$processes"
  case "${RECOVERY_CONTAINER_STATE:-}" in absent|stopped) process_json=$(recovery_absent_process_snapshot "$processes");; running) process_json=$(recovery_process_snapshot "$RECOVERY_CONTAINER_PID" "$RECOVERY_CONTAINER_CGROUP" "$RECOVERY_CONTAINER_NAMESPACE" "$RECOVERY_CONTAINER_PORTS_FILE" "$processes");; *) die 'invalid recovery container state';; esac
  package=$(recovery_package_snapshot); unit=$(recovery_unit_snapshot "$UNIT"); timer=$(recovery_unit_snapshot "$TIMER"); container_json=$(cat "$container")
  base_records=$RECOVERY_RECORDS; records='[]'; record_docker_socket; docker_socket_records=$records; RECOVERY_RECORDS='[]'; recovery_surface docker-daemon docker --host "unix://$CANONICAL_DOCKER_SOCKET" info --format '{{.ServerVersion}} {{.Driver}} {{.DockerRootDir}}'; docker_daemon_records=$RECOVERY_RECORDS; docker_identity=$(/usr/bin/jq -S -cn --argjson socket "$docker_socket_records" --argjson daemon "$docker_daemon_records" '{socket:$socket,daemon:$daemon}') || die 'recovery Docker identity serialization failed'; RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$base_records" --argjson socket "$docker_socket_records" --argjson daemon "$docker_daemon_records" '$old + $socket + $daemon') || die 'recovery Docker evidence merge failed'
  /usr/bin/jq -S -n --argjson package "$package" --argjson unit "$unit" --argjson timer "$timer" --argjson container "$container_json" --argjson model "$RECOVERY_MUTABLE_MODEL" --argjson cron "$RECOVERY_MUTABLE_CRON" --argjson processes "$process_json" --argjson records "$RECOVERY_RECORDS" --argjson dependencies "$deps" --argjson consumerCounts "$consumer_counts" --argjson consumerEvidence "$consumer_evidence" '{package:$package,units:[$unit,$timer],container:$container,model:$model,crontab:$cron,processes:$processes,surfaces:$records,dependencies:$dependencies,consumerCounts:$consumerCounts,consumerEvidence:$consumerEvidence,dependencyTaxonomy:["disabled","external-provider","ollama-loopback","unknown"]}' >"$snapshot" || die 'recovery snapshot serialization failed'
  recovery_terminal_process_snapshot "$processes" "$process_json"; recovery_terminal_container_snapshot; recovery_terminal_mutable_consumers "$mutable"; recovery_terminal_container_consumers "$containers"; terminal_package=$(recovery_package_snapshot); package_before=$(printf '%s\n' "$package" | /usr/bin/jq -S -c .) && package_after=$(printf '%s\n' "$terminal_package" | /usr/bin/jq -S -c .) && [ "$package_before" = "$package_after" ] || review_required 'recovery package changed before receipt publication'; terminal_unit=$(recovery_unit_snapshot "$UNIT"); terminal_timer=$(recovery_unit_snapshot "$TIMER"); units_before=$(/usr/bin/jq -S -cn --argjson unit "$unit" --argjson timer "$timer" '[$unit,$timer]') && units_after=$(/usr/bin/jq -S -cn --argjson unit "$terminal_unit" --argjson timer "$terminal_timer" '[$unit,$timer]') && [ "$units_before" = "$units_after" ] || review_required 'recovery unit state changed before receipt publication'; terminal_records=$RECOVERY_RECORDS; records='[]'; assert_docker_socket; record_docker_socket; terminal_socket_records=$records; RECOVERY_RECORDS='[]'; recovery_surface docker-daemon docker --host "unix://$CANONICAL_DOCKER_SOCKET" info --format '{{.ServerVersion}} {{.Driver}} {{.DockerRootDir}}'; terminal_daemon_records=$RECOVERY_RECORDS; terminal_docker_identity=$(/usr/bin/jq -S -cn --argjson socket "$terminal_socket_records" --argjson daemon "$terminal_daemon_records" '{socket:$socket,daemon:$daemon}') || die 'recovery terminal Docker identity serialization failed'; RECOVERY_RECORDS=$terminal_records; [ "$docker_identity" = "$terminal_docker_identity" ] || review_required 'recovery Docker identity changed before receipt publication'; recovery_write_receipt "$snapshot"; rm -f "$snapshot" "$cron" "$processes" "$container" "$mutable" "$containers" "${RECOVERY_EXTERNAL_CRON_SOURCES:-}"; [ -z "${RECOVERY_CONTAINER_PORTS_FILE:-}" ] || rm -f "$RECOVERY_CONTAINER_PORTS_FILE"; }
