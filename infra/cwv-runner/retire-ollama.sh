#!/bin/sh
# Privileged, scan-first retirement. It never writes candidate endpoint values.
set -eu
if [ "$(/usr/bin/id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then PATH="$RETIRE_OLLAMA_TEST_BIN:/usr/bin:/bin"; else PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; fi
export PATH LC_ALL=C.UTF-8 TZ=Etc/UTC
umask 077
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
INVENTORY=${RETIRE_OLLAMA_INVENTORY:-"$SCRIPT_DIR/ollama-active-inventory.json"}
RECEIPT_DIR=${RETIRE_OLLAMA_RECEIPT_DIR:-/srv/baci-cwv/retired-ollama}
RECEIPT="$RECEIPT_DIR/receipt.json"; RECEIPT_SHA="$RECEIPT_DIR/receipt.sha256"
UNIT=ollama.service; TIMER=ollama-watchdog.timer; CONTAINER=ollama-loopback; AT_JOB_DIR=/var/spool/cron/atjobs; export AT_JOB_DIR
DOCKER_SOCKET_ALIAS=/var/run/docker.sock; CANONICAL_DOCKER_SOCKET=''; DOCKER_SOCKET_IDENTITY=''; DOCKER_SOCKET_SCAN_IDENTITY=''; STORE=/usr/share/ollama/.ollama; OWNER=bassey
PRE_CRON_SHA=a57aee33c02252e61943639c292e96a695ee75a33d92f730fd1be830a67a747b
POST_CRON_SHA=603d5005ad4f7b7d8c535be7ac8b8379b69a83b550014a56b2dfa6bbdb51ba8f
OLLAMA_CRON_ONE=4cee5cdc723001694bc0d2ea22be4db9ff91a1df5f969dc95d2483f55900519d
OLLAMA_CRON_TWO=3b27b446d253183977b01ea6e94c09a0d5bb4ac7d2414ad162ddd7fb49a6fc81
PACKAGE_FORMAT="\${Version}"
# shellcheck disable=SC2034 # Consumer scanners are loaded lazily after trusted primitives.
COMPOSE_ROOTS='/srv /home/bassey'
# shellcheck disable=SC2034 # Consumer scanners are loaded lazily after trusted primitives.
NGINX_ROOT=/etc/nginx
# shellcheck disable=SC2034 # Consumer scanners are loaded lazily after trusted primitives.
SYSTEMD_ROOTS='/etc/systemd/system /lib/systemd/system'
TEMP_ROOT=''
EXIT_REVIEW_REQUIRED=78
die() { printf '%s\n' "$1" >&2; exit "${2:-65}"; }
review_required() { die "$1" "$EXIT_REVIEW_REQUIRED"; }
usage() { die 'usage: retire-ollama.sh --scan|--apply|--recovery-scan' 64; }
root() { [ "$(id -u)" = 0 ] || die 'root required' 77; }
TEMP_ROOT_HELPER_LOADED=''
load_temp_root_helper() { [ "$TEMP_ROOT_HELPER_LOADED" = yes ] && return 0; helper="$SCRIPT_DIR/retire-ollama-temp-root.sh"; if [ ! -f "$helper" ] && [ "$(/usr/bin/id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then candidate=$(pwd -P)/infra/cwv-runner/retire-ollama-temp-root.sh; [ -f "$candidate" ] && helper=$candidate; fi; [ -f "$helper" ] && [ ! -L "$helper" ] || die 'temporary root helper missing'; source_loader_source "$helper" || die 'temporary root helper source failed'; TEMP_ROOT_HELPER_SHA=$SOURCE_LOADER_DIGEST; TEMP_ROOT_HELPER_LOADED=yes; }
cleanup_temp() { load_temp_root_helper; _cleanup_temp; }; init_temp_root() { load_temp_root_helper; _init_temp_root; }
temp_path() { load_temp_root_helper; _temp_path; }
fsync_file() { load_temp_root_helper; _fsync_file "$@"; }
fsync_dir() { load_temp_root_helper; _fsync_dir "$@"; }
source_loader_snapshot_file() { /usr/bin/perl -MFcntl=O_RDONLY,O_NOFOLLOW,O_WRONLY,O_TRUNC -e 'my($s,$d)=@ARGV;sub f{exit 2};sub sameid{my($a,$b)=@_;return @$a&&@$b&&$a->[0]==$b->[0]&&$a->[1]==$b->[1]&&$a->[2]==$b->[2]&&$a->[3]==$b->[3]&&$a->[4]==$b->[4]&&$a->[5]==$b->[5]};sub same{my($a,$b)=@_;return sameid($a,$b)&&$a->[7]==$b->[7]&&$a->[9]==$b->[9]&&$a->[10]==$b->[10]};my@b=lstat($s);f()unless@b&&($b[2]&0170000)==0100000&&$b[3]==1;sysopen(my$i,$s,O_RDONLY|O_NOFOLLOW)||f();my@o=stat($i);f()unless same(\@b,\@o);my$x="";while(1){my$n=sysread($i,my$c,65536);defined$n||f();last unless$n;$x.=$c;length$x<=8388608||f()}my@a=lstat($s);f()unless same(\@o,\@a);close($i)||f();my@t=lstat($d);f()unless@t&&($t[2]&0170000)==0100000&&$t[3]==1;sysopen(my$o,$d,O_WRONLY|O_TRUNC|O_NOFOLLOW)||f();my@w=stat($o);f()unless sameid(\@t,\@w);my$p=0;while($p<length$x){my$n=syswrite($o,$x,length$x-$p,$p);defined$n&&$n>0||f();$p+=$n}close($o)||f()' "$1" "$2"; }; source_loader_source() { local source_loader_input=$1 source_loader_dir source_loader_snapshot_dir source_loader_snapshot source_loader_digest source_loader_status source_loader_parent_depth source_loader_fd source_loader_snapshot_identity source_loader_fd_identity; SOURCE_LOADER_DIGEST=; [ -f "$source_loader_input" ] && [ ! -L "$source_loader_input" ] || return 2; source_loader_parent_depth=${SOURCE_LOADER_DEPTH:-0}; case "$source_loader_parent_depth" in ''|*[!0-9]*) return 2;; esac; source_loader_fd=$((9 - source_loader_parent_depth)); case "$source_loader_fd" in 3|4|5|6|7|8|9) :;; *) return 2;; esac; SOURCE_LOADER_DEPTH=$((source_loader_parent_depth + 1)); source_loader_dir=${source_loader_input%/*}; [ "$source_loader_dir" = "$source_loader_input" ] && source_loader_dir=.; if [ -n "${TEMP_ROOT:-}" ]; then type temp_root_verify_root >/dev/null 2>&1 || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; temp_root_verify_root || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; source_loader_snapshot_dir=$TEMP_ROOT; else source_loader_snapshot_dir=$source_loader_dir; fi; source_loader_snapshot=$(/usr/bin/mktemp "$source_loader_snapshot_dir/.retire-ollama-source.XXXXXX") || { SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; source_loader_snapshot_file "$source_loader_input" "$source_loader_snapshot" || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; source_loader_digest=$(source_loader_digest_file "$source_loader_snapshot") || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; source_loader_snapshot_identity=$(/usr/bin/perl -e '@s=stat($ARGV[0]); @s || exit 2; print join(":", @s[0,1,2,3,4,5]), "\n"' "$source_loader_snapshot") || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; eval "exec ${source_loader_fd}<\"\$source_loader_snapshot\"" || { /bin/rm -f -- "$source_loader_snapshot"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; source_loader_fd_identity=$(SOURCE_LOADER_FD=$source_loader_fd /usr/bin/perl -e '$fd=$ENV{SOURCE_LOADER_FD}; open(my$f,"<&=",$fd) || exit 2; @s=stat($f); @s || exit 2; print join(":", @s[0,1,2,3,4,5]), "\n"') || { /bin/rm -f -- "$source_loader_snapshot"; eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; [ "$source_loader_snapshot_identity" = "$source_loader_fd_identity" ] || { /bin/rm -f -- "$source_loader_snapshot"; eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; /bin/rm -f -- "$source_loader_snapshot" || { eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; [ ! -e "$source_loader_snapshot" ] || { eval "exec ${source_loader_fd}<&-"; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; return 2; }; . "/dev/fd/$source_loader_fd"; source_loader_status=$?; eval "exec ${source_loader_fd}<&-" || source_loader_status=2; SOURCE_LOADER_DEPTH=$source_loader_parent_depth; [ "$source_loader_status" -eq 0 ] && SOURCE_LOADER_DIGEST=$source_loader_digest; return "$source_loader_status"; }
source_loader_digest_file() { local source_loader_digest_output source_loader_digest; if [ -x /usr/bin/sha256sum ]; then source_loader_digest_output=$(/usr/bin/sha256sum "$1") || return 2; elif [ -x /usr/bin/shasum ]; then source_loader_digest_output=$(/usr/bin/shasum -a 256 "$1") || return 2; else return 2; fi; source_loader_digest=${source_loader_digest_output%%[[:space:]]*}; case "$source_loader_digest" in ''|*[!a-f0-9]*) return 2;; esac; [ "${#source_loader_digest}" -eq 64 ] || return 2; printf '%s\n' "$source_loader_digest"; }
safe_file() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u:%a' "$1")" = '0:600' ]; }
safe_dir() { [ -d "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u:%a' "$1")" = '0:700' ]; }
ipv4_loopback() { /usr/bin/printf '%s\n' "$1" | /usr/bin/awk -F. 'NF == 4 && $1 == "127" { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i > 255) exit 1; exit 0 } { exit 1 }'; }
classify_endpoint() { value=$1; case "$value" in ''|disabled|none) printf disabled; return;; http://*) scheme=http; rest=${value#http://};; https://*) scheme=https; rest=${value#https://};; *) printf unknown; return;; esac; authority=${rest%%\?*}; authority=${authority%%\#*}; authority=${authority%%/*}; case "$authority" in ''|*@*|*[[:space:]]*|*:) printf unknown; return;; esac; host=$authority; port=''; case "$authority" in \[*\]:*) host=${authority%%]*}; host=${host#\[}; port=${authority#*\]:};; \[*\]) host=${authority#\[}; host=${host%\]};; *:*) host=${authority%:*}; port=${authority##*:}; case "$host:$port" in *:*:*|*:*[!0-9]*) printf unknown; return;; esac;; esac; case "$host" in ::1|[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt]|[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt].) local_host=1;; *) if ipv4_loopback "$host"; then local_host=1; else local_host=0; fi;; esac; if [ "$scheme:$local_host:$port" = http:1:11434 ]; then printf ollama-loopback; elif [ "$scheme:$local_host" = https:0 ]; then printf external-provider; else printf unknown; fi; }
sha() {
  input=$1; out=$(temp_path)
  sha256sum "$input" >"$out" || { rm -f "$out"; die "digest failed $input"; }
  IFS=' ' read -r digest _ <"$out" || { rm -f "$out"; die "digest read failed $input"; }
  rm -f "$out"; case "$digest" in *[!0-9a-f]*|'') die "invalid digest $input";; *) [ "${#digest}" -eq 64 ] || die "invalid digest $input";; esac
  printf '%s\n' "$digest"
}
hash_text() { out=$(temp_path); printf %s "$1" >"$out" || { rm -f "$out"; die 'text digest write failed'; }; sha "$out"; status=$?; rm -f "$out"; return "$status"; }
RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"
if [ -f "$RECOVERY_HELPER" ] && [ ! -L "$RECOVERY_HELPER" ]; then
  RECOVERY_HELPER_SOURCE_SHA=$(source_loader_digest_file "$RECOVERY_HELPER") || die 'recovery helper digest failed'
  # shellcheck disable=SC1090,SC1091 # Resolved beside this script at runtime.
  source_loader_source "$RECOVERY_HELPER" || die 'recovery helper source failed'
  RECOVERY_HELPER_LOADED_SHA=$SOURCE_LOADER_DIGEST
  [ "$RECOVERY_HELPER_SOURCE_SHA" = "$RECOVERY_HELPER_LOADED_SHA" ] || die 'recovery helper changed during load'
fi
digest_command() {
  out=$1; class=$2; shift 2
  if "$@" >"$out"; then :; else status=$?; rm -f "$out"; die "scan failed $class ($status)"; fi
  sha "$out"
}
records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; APPROVED_OLLAMA_PID=''; APPROVED_OLLAMA_PROCESS_IDENTITY=''
cron_line_approved() { cron_sha=$(hash_text "$1") || die 'cron line digest failed'; case "$cron_sha" in "$OLLAMA_CRON_ONE"|"$OLLAMA_CRON_TWO") return 0;; *) return 1;; esac; }
process_line_approved() { [ -n "$APPROVED_OLLAMA_PID" ] && [ -n "$APPROVED_OLLAMA_PROCESS_IDENTITY" ] || return 1; /usr/bin/printf '%s\n' "$1" | /usr/bin/awk -v approved="$APPROVED_OLLAMA_PID" 'NF == 5 && $1 == approved && $4 == "/usr/bin/ollama" && $5 == "serve" { exit 0 } { exit 1 }'; }
review_ollama_service_process_begin() { APPROVED_OLLAMA_PID=''; APPROVED_OLLAMA_PROCESS_IDENTITY=''; pid=$(systemctl show "$UNIT" -p MainPID --value) || die 'Ollama service MainPID scan failed'; case "$pid" in ''|*[!0-9]*) review_required 'invalid Ollama service MainPID';; 0) return;; esac; identity=$(recovery_process_lifetime_marker "$pid") || review_required 'Ollama service process identity unavailable'; recovery_sha256 "$identity" || review_required 'invalid Ollama service process identity'; APPROVED_OLLAMA_PID=$pid; APPROVED_OLLAMA_PROCESS_IDENTITY=$identity; }
review_ollama_service_process_finish() { [ -n "$APPROVED_OLLAMA_PID" ] || return 0; pid=$(systemctl show "$UNIT" -p MainPID --value) || die 'Ollama service MainPID recheck failed'; [ "$pid" = "$APPROVED_OLLAMA_PID" ] || review_required 'Ollama service MainPID changed'; identity=$(recovery_process_lifetime_marker "$pid") || review_required 'Ollama service process identity unavailable'; [ "$identity" = "$APPROVED_OLLAMA_PROCESS_IDENTITY" ] || review_required 'Ollama service process identity changed'; }
record_running_process_environments() { file=$1; type recovery_process_environment_evidence >/dev/null 2>&1 || review_required 'process environment scanner missing'; while IFS=' ' read -r pid ppid user args || [ -n "$pid$ppid$user$args" ]; do case "$pid" in PID) continue;; ''|*[!0-9]*) review_required 'invalid running process pid';; esac; [ "$pid" = "$$" ] && continue; process_line_approved "$pid $ppid $user $args" && continue; evidence=$(recovery_process_environment_evidence "$pid"); state=$(printf '%s\n' "$evidence" | jq -r '.state // "present"') || review_required 'invalid process environment evidence'; [ "$state" = vanished ] && continue; [ "$state" = present ] || review_required 'invalid process environment evidence'; match=$(printf '%s\n' "$evidence" | jq -r '.matchingEnvironmentSha256 // empty') || review_required 'invalid process environment evidence'; [ -z "$match" ] || recovery_record_process_environment_consumer "$evidence"; done <"$file"; }
record_running_process_sockets() { file=$1; socket_processes=$(temp_path); awk 'NR==1 { if ($1=="PID" && $2=="PPID" && $3=="USER") next; bad=1; next } { pid=$1; ppid=$2; if (pid!~/^[0-9]+$/ || ppid!~/^[0-9]+$/ || NF<4) { bad=1; next } sub(/^[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+[^[:space:]]+[[:space:]]+/,""); print pid " " ppid " " $0 } END { exit bad?2:0 }' "$file" >"$socket_processes" || { rm -f "$socket_processes"; review_required 'invalid socket process inventory'; }; RECOVERY_CLIENT_SOCKETS_ONLY=yes; recovery_socket_snapshot '' '' '' '' "$socket_processes"; records=$(jq -cn --argjson old "$records" --arg sha "$RECOVERY_SOCKET_SNAPSHOT_SHA" '$old + [{class:"running-process-sockets",sha256:$sha}]') || die 'socket record failed'; RECOVERY_CLIENT_SOCKETS_ONLY=''; rm -f "$socket_processes"; }
record_consumers() {
  class=$1 file=$2 mode=${3:-matched}; count=0; unknown_sha=$(hash_text unknown)
  while IFS= read -r line || [ -n "$line" ]; do
    case "$mode" in
      cron|cron-unapproved)
        match_line=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')
        if [ "$mode" = cron ] && cron_line_approved "$line"; then matched=0
        else case "$match_line" in
          *11434*|*'/ollama '*|*' ollama '*|ollama|ollama=*|ollama_*=*|/ollama) matched=1;;
          *) matched=0;;
        esac; fi;;
      none) matched=0;;
      all) case "$line" in container-docker-socket:*) matched=0;; *) matched=1;; esac;;
      *) if process_line_approved "$line"; then matched=0; else match_line=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]'); case "$match_line" in *11434*|*'/ollama '*|*' ollama '*|ollama|*/ollama) matched=1;; *) matched=0;; esac; fi;;
    esac
    [ "$matched" = 1 ] || continue; count=$((count + 1)); evidence=$(hash_text "$line")
    deps=$(jq -cn --argjson old "$deps" --arg key "$class:$count" --arg value "$unknown_sha" --arg source "$evidence" '$old + [{"key-name":$key,"endpoint-class":"unknown","normalized-value-sha256":$value,"source-path-sha256":$source,disposition:"consumer"}]') || die 'consumer dependency record failed'
    consumer_evidence=$(jq -cn --argjson old "$consumer_evidence" --arg surface "$class" --arg sha "$evidence" '$old + [{surface:$surface,classifiedPathSha256:$sha}]') || die 'consumer evidence record failed'
  done <"$file"
  consumer_counts=$(jq -cn --argjson old "$consumer_counts" --arg surface "$class" --argjson count "$count" '$old + [{surface:$surface,matchCount:$count}]') || die 'consumer count record failed'
}
# shellcheck disable=SC1090,SC1091 # Sealed sibling or unprivileged test-injected helper.
load_cron_inventory_helper() { [ "${CRON_INVENTORY_HELPER_LOADED:-}" = yes ] && return; if [ "$(id -u)" = 0 ]; then [ -z "${RETIRE_OLLAMA_CRON_INVENTORY_HELPER:-}" ] || die 'privileged cron inventory helper override refused'; helper="$SCRIPT_DIR/retire-ollama-cron-inventory.sh"; elif [ -n "${RETIRE_OLLAMA_CRON_INVENTORY_HELPER:-}" ]; then [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] || die 'cron inventory helper override requires test harness'; helper=$RETIRE_OLLAMA_CRON_INVENTORY_HELPER; else helper="$SCRIPT_DIR/retire-ollama-cron-inventory.sh"; fi; [ -f "$helper" ] && [ ! -L "$helper" ] || die 'cron inventory helper missing'; source_loader_source "$helper" || die 'cron inventory helper source failed'; cron_inventory_helper_sha=$SOURCE_LOADER_DIGEST; [ -z "${RECOVERY_CRON_INVENTORY_SHA:-}" ] || [ "$cron_inventory_helper_sha" = "$RECOVERY_CRON_INVENTORY_SHA" ] || { die 'cron inventory helper changed'; return 2; }; CRON_INVENTORY_HELPER_SHA=$cron_inventory_helper_sha; CRON_INVENTORY_HELPER_LOADED=yes; }
# shellcheck disable=SC1090,SC1091 # Sealed sibling or unprivileged test-injected helper.
load_at_quiescence_helper() { [ "${AT_QUIESCENCE_LOADED:-}" = yes ] && return; if [ "$(id -u)" = 0 ]; then [ -z "${RETIRE_OLLAMA_AT_QUIESCENCE_HELPER:-}" ] || die 'privileged at quiescence helper override refused'; helper="$SCRIPT_DIR/retire-ollama-at-quiescence.sh"; elif [ -n "${RETIRE_OLLAMA_AT_QUIESCENCE_HELPER:-}" ]; then [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] || die 'at quiescence helper override requires test harness'; helper=$RETIRE_OLLAMA_AT_QUIESCENCE_HELPER; else helper="$SCRIPT_DIR/retire-ollama-at-quiescence.sh"; fi; [ -f "$helper" ] && [ ! -L "$helper" ] || die 'at quiescence helper missing'; source_loader_source "$helper" || die 'at quiescence helper source failed'; AT_QUIESCENCE_HELPER_SHA=$SOURCE_LOADER_DIGEST; [ -z "${RECOVERY_AT_QUIESCENCE_SHA:-}" ] || [ "$AT_QUIESCENCE_HELPER_SHA" = "$RECOVERY_AT_QUIESCENCE_SHA" ] || die 'at quiescence helper changed'; AT_QUIESCENCE_LOADED=yes; }
recovery_listener_executable() {
  pid=$1; exe="$RECOVERY_PROC_ROOT/$pid/exe"; [ -L "$exe" ] || review_required 'listener executable link missing'
  observed=$(readlink -- "$exe") || review_required 'listener executable target unavailable'; observed=${observed% (deleted)}
  real=$(readlink -f -- "$exe") || review_required 'listener executable resolution failed'; case "$real" in /*) :;; *) review_required 'listener executable path invalid';; esac
  [ -f "$real" ] && [ -x "$real" ] && [ ! -L "$real" ] || review_required 'listener executable unsafe'
  stat_value=$(stat -Lc '%d:%i:%u:%g:%a' "$exe") || review_required 'listener executable identity failed'; start_value=$(sed 's/.*) //' "$RECOVERY_PROC_ROOT/$pid/stat" | awk '{print $20}'); uid_value=$(awk '/^Uid:/{print $2; exit}' "$RECOVERY_PROC_ROOT/$pid/status")
  if ! recovery_safe_int "$start_value" || ! recovery_nonnegative_int "$uid_value"; then review_required 'listener executable lifetime identity failed'; fi
  /usr/bin/jq -cn --arg path "$observed" --arg real "$real" --arg digest "$(sha "$exe")" --arg identity "$(hash_text "$stat_value")" --arg uid "$uid_value" --arg start "$start_value" '{path:$path,realPath:$real,sha256:$digest,identitySha256:$identity,uid:$uid,startTime:$start}'
}; recovery_socket_table_has_client() { pending_table=$1; pending_address=$2; pending_port=$3; pending_inode=$4; [ -f "$pending_table" ] && [ ! -L "$pending_table" ] || return 2; awk -v address="$pending_address" -v port="$pending_port" -v inode="$pending_inode" 'NR>1{split($3,remote_endpoint,":");if(($4=="01"||$4=="02")&&remote_endpoint[1]==address&&remote_endpoint[2]==port&&$10==inode)found=1}END{exit found?0:1}' "$pending_table"; }; recovery_pending_socket_present() { pending_family=$1; pending_address=$2; pending_port=$3; pending_inode=$4; pending_processes=$5; case "$pending_family" in tcp|tcp6) :;; *) return 2;; esac; if recovery_socket_table_has_client "$RECOVERY_PROC_ROOT/net/$pending_family" "$pending_address" "$pending_port" "$pending_inode"; then return 0; else pending_status=$?; [ "$pending_status" -eq 1 ] || return "$pending_status"; fi; while IFS=' ' read -r pending_pid _ || [ -n "$pending_pid" ]; do [ -n "$pending_pid" ] || continue; recovery_safe_int "$pending_pid" || return 2; pending_root="$RECOVERY_PROC_ROOT/$pending_pid"; [ -e "$pending_root" ] || [ -L "$pending_root" ] || continue; if recovery_socket_table_has_client "$pending_root/net/$pending_family" "$pending_address" "$pending_port" "$pending_inode"; then return 0; else pending_status=$?; [ "$pending_status" -eq 1 ] || return "$pending_status"; fi; done <"$pending_processes"; return 1; }
recovery_socket_snapshot() {
  container_pid=$1; container_cgroup=$2; container_namespace=$3; ports=$4; processes=$5; listeners='[]'; seen=''
  socket_directory="$RECOVERY_PROC_ROOT/net"; if [ -L "$socket_directory" ]; then [ "$RECOVERY_PROC_ROOT" = /proc ] && [ "$(readlink -- "$socket_directory")" = self/net ] || review_required 'unsafe recovery socket directory'; else [ -d "$socket_directory" ] || review_required 'recovery socket directory unavailable'; fi
  for table in "$RECOVERY_PROC_ROOT/net/tcp" "$RECOVERY_PROC_ROOT/net/tcp6"; do [ -f "$table" ] && [ ! -L "$table" ] || review_required 'unsafe recovery socket table'; done
  raw=$(temp_path); for table in "$RECOVERY_PROC_ROOT/net/tcp" "$RECOVERY_PROC_ROOT/net/tcp6"; do family=tcp; case "$table" in *tcp6) family=tcp6;; esac; awk -v family="$family" -v clientsOnly="${RECOVERY_CLIENT_SOCKETS_ONLY:-}" 'NR > 1 { split($2,local_endpoint,":"); split($3,remote_endpoint,":"); if (clientsOnly != "yes" && $4 == "0A" && local_endpoint[2] == "2CAA") print family "|listener|" local_endpoint[1] "|" local_endpoint[2] "|" $10 "|" $4; else if (($4 == "01" || $4 == "02" || $4 == "08") && remote_endpoint[2] == "2CAA") print family "|client|" remote_endpoint[1] "|" remote_endpoint[2] "|" $10 "|" $4 }' "$table" >>"$raw" || die 'recovery socket table scan failed'; done
  while IFS=' ' read -r pid _ || [ -n "$pid" ]; do
    [ -n "$pid" ] || continue; recovery_safe_int "$pid" || review_required 'invalid socket process pid'; process_root="$RECOVERY_PROC_ROOT/$pid"; [ -e "$process_root" ] || [ -L "$process_root" ] || continue; process_net="$process_root/net"; if [ ! -d "$process_net" ] || [ -L "$process_net" ]; then [ "$RECOVERY_PROC_ROOT" != /proc ] && continue; review_required 'unsafe process socket directory'; fi; network_link="$process_root/ns/net"; [ -L "$network_link" ] || review_required 'process network namespace unavailable'; network_before=$(readlink -- "$network_link") || review_required 'process network namespace unavailable'; printf '%s\n' "$network_before" | grep -Eq '^net:\[[0-9]+\]$' || review_required 'invalid process network namespace'; before=$(recovery_process_lifetime_marker "$pid") || review_required 'socket process lifetime unavailable'; process_raw=$(temp_path)
    for name in tcp tcp6; do table="$process_net/$name"; [ -f "$table" ] && [ ! -L "$table" ] || { rm -f "$process_raw"; review_required 'unsafe process socket table'; }; family=$name; awk -v family="$family" -v clientsOnly="${RECOVERY_CLIENT_SOCKETS_ONLY:-}" 'NR > 1 { split($2,local_endpoint,":"); split($3,remote_endpoint,":"); if (clientsOnly != "yes" && $4 == "0A" && local_endpoint[2] == "2CAA") print family "|listener|" local_endpoint[1] "|" local_endpoint[2] "|" $10 "|" $4; else if (($4 == "01" || $4 == "02" || $4 == "08") && remote_endpoint[2] == "2CAA") print family "|client|" remote_endpoint[1] "|" remote_endpoint[2] "|" $10 "|" $4 }' "$table" >>"$process_raw" || { rm -f "$process_raw"; die 'process socket table scan failed'; }; done
    after=$(recovery_process_lifetime_marker "$pid") || { rm -f "$process_raw"; review_required 'socket process lifetime unavailable'; }; network_after=$(readlink -- "$network_link") || { rm -f "$process_raw"; review_required 'process network namespace unavailable'; }; [ "$before" = "$after" ] && [ "$network_before" = "$network_after" ] || { rm -f "$process_raw"; review_required 'socket process lifetime changed'; }; cat "$process_raw" >>"$raw" || { rm -f "$process_raw"; die 'process socket snapshot merge failed'; }; rm -f "$process_raw"
  done <"$processes"
  sorted=$(temp_path); reconciled=$(temp_path); sort -u "$raw" >"$sorted" || { rm -f "$raw" "$sorted" "$reconciled"; die 'recovery socket snapshot sort failed'; }; rm -f "$raw"; raw=$sorted
  while IFS='|' read -r family socket_role address port inode socket_state || [ -n "$family$socket_role$address$port$inode$socket_state" ]; do
    [ -n "$inode" ] || continue; found=0
    while IFS=' ' read -r pid ppid args || [ -n "$pid$ppid$args" ]; do
      [ -n "$pid" ] || continue; recovery_safe_int "$pid" || review_required 'invalid listener pid'; [ -d "$RECOVERY_PROC_ROOT/$pid/fd" ] && [ ! -L "$RECOVERY_PROC_ROOT/$pid/fd" ] || continue
      for fd in "$RECOVERY_PROC_ROOT/$pid/fd"/*; do [ -L "$fd" ] || continue; link=$(readlink -- "$fd") || review_required 'listener fd target unavailable'; [ "$link" = "socket:[$inode]" ] || continue; case " $seen " in *" $pid/$inode "*) continue;; esac; seen="$seen $pid/$inode"; found=1; command=${args%% *}; base=${command##*/}; class=foreign-listener; [ "$socket_role" = listener ] || class=foreign-client; executable=''
        if [ "$socket_role" = listener ] && [ -n "$container_pid" ] && [ "$pid" = "$container_pid" ]; then identity=$(recovery_process_identity "$pid"); IFS=' ' read -r cgroup namespace extra <<EOF
$identity
EOF
          [ -z "${extra:-}" ] && [ "$cgroup" = "$container_cgroup" ] && [ "$namespace" = "$container_namespace" ] || review_required 'listener container identity drift'; class=container; executable=$(recovery_process_executable "$pid" "$RECOVERY_CONTAINER_COMMAND_PATH" ollama)
        elif [ "$socket_role" = listener ] && [ "$base" = docker-proxy ] && recovery_proxy_ports_ok "$args" "$ports"; then class=docker-proxy; executable=$(recovery_process_executable "$pid" docker-proxy docker-proxy); else executable=$(recovery_listener_executable "$pid"); fi
        listeners=$(/usr/bin/jq -cn --argjson old "$listeners" --arg family "$family" --arg address "$address" --arg port "$port" --arg inode "$inode" --arg pid "$pid" --arg class "$class" --argjson executable "$executable" '$old + [{family:$family,localAddressHex:$address,port:11434,inode:$inode,pid:$pid,class:$class,executable:$executable}]') || die 'listener serialization failed'
        case "$class" in foreign-listener) review_required 'unreviewed port-11434 listener';; foreign-client) review_required 'unreviewed port-11434 client';; esac
      done
    done <"$processes"
    if [ "$found" -ne 1 ] && [ "$socket_role:$socket_state" = client:02 ]; then if recovery_pending_socket_present "$family" "$address" "$port" "$inode" "$processes"; then :; else pending_status=$?; [ "$pending_status" -eq 1 ] && continue; review_required 'pending port-11434 client recheck failed'; fi; fi; [ "$found" -eq 1 ] || review_required "unbound port-11434 $socket_role"; printf '%s|%s|%s|%s|%s|%s\n' "$family" "$socket_role" "$address" "$port" "$inode" "$socket_state" >>"$reconciled" || die 'socket reconciliation failed'
  done <"$raw"; rm -f "$raw"; raw=$reconciled
  # shellcheck disable=SC2034 # Exported through the recovery process snapshot.
  if [ -s "$raw" ]; then RECOVERY_SOCKET_SNAPSHOT_SHA=$(sha "$raw"); else RECOVERY_SOCKET_SNAPSHOT_SHA=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; fi
  # shellcheck disable=SC2034 # Exported through the recovery process snapshot.
  RECOVERY_LISTENING_SOCKETS=$listeners; rm -f "$raw"
}
record_scan() {
  class=$1; shift; out=$(temp_path); value=$(digest_command "$out" "$class" "$@")
  records=$(jq -cn --argjson old "$records" --arg class "$class" --arg sha "$value" '$old + [{class:$class,sha256:$sha}]') || die "record failed $class"
  case "$class" in systemd-definitions|reverse-proxy|compose-definitions|running-containers|container-definitions) record_consumers "$class" "$out" all;; running-processes) record_consumers "$class" "$out";; esac
  rm -f "$out"
}
record_path() {
  class=$1 path=$2
  [ -e "$path" ] && [ ! -L "$path" ] || die "unsafe $class path"
  real=$(readlink -f -- "$path") || die "cannot resolve $class path"; [ "$real" = "$path" ] || die "replaced $class path"
  raw=$(temp_path); { stat -c '%d:%i:%f:%s:%u:%g:%a' "$path"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$path"; } >"$raw" || { rm -f "$raw"; die "identity scan failed $class"; }
  fingerprint=$(sha "$raw"); rm -f "$raw"
  case "$(stat -c '%F' "$path")" in 'regular file') bytes=$(sha "$path");; *) bytes=$fingerprint;; esac
  records=$(jq -cn --argjson old "$records" --arg class "$class" --arg path "$real" --arg sha "$bytes" --arg identity "$fingerprint" '$old + [{class:$class,realPath:$path,sha256:$sha,identitySha256:$identity}]') || die "path record failed $class"
}
assert_docker_socket() {
  [ "$(readlink -f -- /var/run)" = /run ] || die 'unreviewed Docker socket alias'
  real=$(readlink -f -- "$DOCKER_SOCKET_ALIAS") || die 'cannot resolve Docker socket'
  [ "$real" = /run/docker.sock ] || die 'unreviewed Docker socket target'
  [ -S "$real" ] && [ ! -L "$real" ] || die 'unsafe Docker socket'
  [ ! -L /run ] && [ "$(stat -c '%u:%a' /run)" = '0:755' ] || die 'unsafe Docker runtime directory'
  docker_group=$(getent group docker 2>/dev/null) || die 'Docker group missing'
  docker_gid=${docker_group#docker:x:}; docker_gid=${docker_gid%%:*}
  case "$docker_gid" in ''|*[!0-9]*) die 'invalid Docker group';; esac
  [ "$(stat -Lc '%u:%g:%a' "$real")" = "0:$docker_gid:660" ] || die 'Docker socket owner or mode drift'
  source_identity=$(stat -Lc '%d:%i:%f:%u:%g:%a' "$DOCKER_SOCKET_ALIAS") || die 'Docker socket source identity failed'
  real_identity=$(stat -Lc '%d:%i:%f:%u:%g:%a' "$real") || die 'Docker socket identity failed'
  [ "$source_identity" = "$real_identity" ] || die 'docker socket identity changed'
  CANONICAL_DOCKER_SOCKET=$real; DOCKER_SOCKET_IDENTITY=$real_identity
}
docker_socket_scan_begin() { assert_docker_socket; DOCKER_SOCKET_SCAN_IDENTITY=$DOCKER_SOCKET_IDENTITY; }
docker_socket_scan_end() { assert_docker_socket; [ -n "$DOCKER_SOCKET_SCAN_IDENTITY" ] && [ "$DOCKER_SOCKET_SCAN_IDENTITY" = "$DOCKER_SOCKET_IDENTITY" ] || review_required 'Docker socket identity changed during scan'; }
record_docker_socket() {
  raw=$(temp_path); { printf '%s\n' "$CANONICAL_DOCKER_SOCKET"; stat -Lc '%d:%i:%f:%s:%u:%g:%a' "$CANONICAL_DOCKER_SOCKET"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$CANONICAL_DOCKER_SOCKET"; } >"$raw" || { rm -f "$raw"; die 'Docker socket identity scan failed'; }
  fingerprint=$(sha "$raw"); rm -f "$raw"
  records=$(jq -cn --argjson old "$records" --arg path "$CANONICAL_DOCKER_SOCKET" --arg identity "$fingerprint" '$old + [{class:"docker-socket",realPath:$path,identitySha256:$identity}]') || die 'Docker socket record failed'
}
record_dependency() {
  key=$1 value=$2 source=$3 disposition=${4:-review}
  value_sha=$(hash_text "$value"); source_sha=$(hash_text "$source")
  deps=$(jq -cn --argjson old "$deps" --arg key "$key" --arg class "$(classify_endpoint "$value")" --arg value "$value_sha" --arg source "$source_sha" --arg disposition "$disposition" '$old + [{"key-name":$key,"endpoint-class":$class,"normalized-value-sha256":$value,"source-path-sha256":$source,disposition:$disposition}]') || die 'dependency record failed'
}
record_environment() {
  file=$1; record_path environment-files "$file"
  # shellcheck disable=SC2094 # The EnvironmentFile is read only; record_dependency receives its path as data.
  while IFS= read -r line || [ -n "$line" ]; do case "$line" in ''|'#'*) continue;; *=*) record_dependency "${line%%=*}" "${line#*=}" "$file";; *) die 'malformed EnvironmentFile';; esac; done <"$file"
}
load_consumer_scanners() { [ "${CONSUMER_SCANNERS_LOADED:-}" = yes ] && return; if [ "$(id -u)" = 0 ]; then [ -z "${RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER:-}" ] || die 'privileged consumer scanner override refused'; helper="$SCRIPT_DIR/retire-ollama-consumers.sh"; elif [ -n "${RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER:-}" ]; then [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] || die 'consumer scanner override requires test harness'; helper=$RETIRE_OLLAMA_CONSUMER_SCANNER_HELPER; else helper="$SCRIPT_DIR/retire-ollama-consumers.sh"; fi; [ -f "$helper" ] && [ ! -L "$helper" ] || die 'consumer scanner helper missing'; # shellcheck disable=SC1090,SC1091 # Sealed sibling or unprivileged test-injected helper.
consumer_scanner_source_sha=$(source_loader_digest_file "$helper") || die 'consumer scanner digest failed'; source_loader_source "$helper" || die 'consumer scanner source failed'; [ "$consumer_scanner_source_sha" = "$SOURCE_LOADER_DIGEST" ] || die 'consumer scanner changed during load'; [ -z "${RECOVERY_CONSUMERS_SHA:-}" ] || [ "$consumer_scanner_source_sha" = "$RECOVERY_CONSUMERS_SHA" ] || die 'consumer scanner receipt binding changed'; CONSUMER_SCANNERS_LOADED_SHA=$consumer_scanner_source_sha; CONSUMER_SCANNERS_LOADED=yes; }
scan_nginx_definitions() { load_consumer_scanners; scan_nginx_definitions "$@"; }
scan_compose_definitions() { load_consumer_scanners; scan_compose_definitions "$@"; }
scan_systemd_runtime_consumers() { load_consumer_scanners; scan_systemd_runtime_consumers "$@"; }
scan_systemd_consumers() { load_consumer_scanners; scan_systemd_consumers "$@"; }
unit_state() { out=$(temp_path); systemctl show "$1" -p LoadState -p UnitFileState -p ActiveState --value >"$out" || { rm -f "$out"; die "unit state failed $1"; }; tr '\n' ':' <"$out"; rm -f "$out"; }
scan_container_rows() { load_consumer_scanners; scan_container_rows "$@"; }
scan_container_definitions() { scan_container_rows all; }
scan_running_containers() { scan_container_rows running; }
model_identity() {
  [ -d "$STORE" ] && [ ! -L "$STORE" ] || die 'unsafe model store'; parent=$(dirname "$STORE"); [ ! -L "$parent" ] || die 'unsafe model parent'
  [ "$(stat -c '%u:%a' "$STORE")" = '0:755' ] || die 'model store owner or mode drift'; model_parent_mode=$(stat -c '%a' "$parent") || die 'model parent mode scan failed'; case "$model_parent_mode" in ''|*[!0-7]*) die 'invalid model parent mode';; esac; [ $((0$model_parent_mode & 022)) -eq 0 ] || die 'writable model parent'
  list=$(temp_path); sorted=$(temp_path); raw=$(temp_path)
  if find "$STORE" -xdev -type f -printf '%y:%m:%s:%T@:%p:' -exec sha256sum -- {} \; >"$list" && find "$STORE" -xdev ! -type f -printf '%y:%m:%s:%T@:%p\n' >>"$list"; then :; else rm -f "$list" "$sorted" "$raw"; die 'model listing failed'; fi
  sort "$list" >"$sorted" || { rm -f "$list" "$sorted" "$raw"; die 'model sorting failed'; }
  { readlink -f "$STORE"; readlink -f "$parent"; stat -c '%d:%i:%f:%u:%g:%a' "$STORE" "$parent"; findmnt -no TARGET,SOURCE,FSTYPE,OPTIONS --target "$STORE"; cat "$sorted"; } >"$raw" || { rm -f "$list" "$sorted" "$raw"; die 'model identity failed'; }
  sha "$raw"; status=$?; rm -f "$list" "$sorted" "$raw"; return "$status"
}
model_store_bytes() { [ -e "$STORE" ] || { printf '0\n'; return; }; out=$(temp_path); du -sb "$STORE" >"$out" || { rm -f "$out"; die 'model byte scan failed'; }; IFS=' 	' read -r bytes _ <"$out" || { rm -f "$out"; die 'model byte read failed'; }; rm -f "$out"; case "$bytes" in ''|*[!0-9]*) die 'invalid model byte count';; esac; printf '%s\n' "$bytes"; }
model_phase_values() {
  case "$1" in
    scan|delete_models) model_identity; model_store_bytes;;
    revalidate) printf 'unscanned\nunscanned\n';;
    *) die 'unknown collection phase';;
  esac
}
cgroup_memory_bytes() { value=$(cat /sys/fs/cgroup/memory.current) || die 'cgroup memory read failed'; case "$value" in ''|*[!0-9]*) die 'invalid cgroup memory';; esac; printf '%s\n' "$value"; }
host_available_memory_bytes() { out=$(temp_path); awk '/^MemAvailable:/{print $2 * 1024; exit}' /proc/meminfo >"$out" || { rm -f "$out"; die 'host memory read failed'; }; IFS= read -r value <"$out" || { rm -f "$out"; die 'host memory missing'; }; rm -f "$out"; case "$value" in ''|*[!0-9]*) die 'invalid host memory';; esac; printf '%s\n' "$value"; }
completion_metrics() { jq -cn --argjson cgroup "$(cgroup_memory_bytes)" --argjson host "$(host_available_memory_bytes)" --argjson model "$(model_store_bytes)" '{cgroupMemoryBytes:$cgroup,hostAvailableMemoryBytes:$host,modelStoreBytes:$model}'; }
container_id() { docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Id}}' "$CONTAINER"; }
container_config() { out=$(temp_path); CONTAINER_CONFIG_SHA=$(digest_command "$out" container-config docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Id}} {{.Image}} {{.Path}} {{json .Args}} {{json .HostConfig}} {{json .Mounts}} {{json .NetworkSettings.Networks}}' "$CONTAINER"); record_consumers container-config "$out" none; rm -f "$out"; }
collect() {
  records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; id='' image='' config=''; tmp=${1:?snapshot path}; phase=${2:-scan}; cron="$tmp.cron"
  load_cron_inventory_helper; RETIRE_OLLAMA_CRON_SOURCES=$(temp_path); cron_inventory_collect_external "$RETIRE_OLLAMA_CRON_SOURCES"
  docker_socket_scan_begin; record_scan container-definitions scan_container_definitions
  systemctl cat "$UNIT" >"$tmp.unit" || die 'systemd definition scan failed'; record_scan systemd-definitions scan_systemd_consumers
  fragment=$(systemctl show "$UNIT" -p FragmentPath --value) || die 'fragment scan failed'; record_path systemd-fragments "$fragment"
  drops=$(temp_path); systemctl show "$UNIT" -p DropInPaths --value >"$drops" || { rm -f "$drops"; die 'drop-in scan failed'; }; while IFS= read -r path || [ -n "$path" ]; do for item in $path; do record_path systemd-drop-ins "$item"; done; done <"$drops"; rm -f "$drops"
  envs=$(temp_path); systemctl show "$UNIT" -p EnvironmentFiles --value >"$envs" || { rm -f "$envs"; die 'environment file scan failed'; }; while IFS= read -r path || [ -n "$path" ]; do for item in $path; do record_environment "${item#-}"; done; done <"$envs"; rm -f "$envs"
  record_scan systemd-timers systemctl list-timers --all; record_scan reverse-proxy scan_nginx_definitions; record_scan compose-definitions scan_compose_definitions
  if crontab -u "$OWNER" -l >"$cron" 2>/dev/null; then :; else status=$?; [ "$status" -eq 1 ] || die 'crontab scan failed'; : >"$cron"; fi; cron_sha=$(sha "$cron")
  case "$phase:$cron_sha" in scan:"$PRE_CRON_SHA"|revalidate:"$PRE_CRON_SHA"|revalidate:"$POST_CRON_SHA"|delete_models:"$POST_CRON_SHA") :;; *) die 'crontab drift';; esac
  record_scan current-crontab cat "$cron"; review_ollama_service_process_begin; processes=$(temp_path); ps -ww -eo pid,ppid,user,args >"$processes" || { rm -f "$processes"; die 'process scan failed'; }; record_scan running-processes cat "$processes"; record_running_process_environments "$processes"; record_running_process_files "$processes"; record_running_process_sockets "$processes"; review_ollama_service_process_finish; rm -f "$processes"; record_scan running-containers scan_running_containers
  record_external_cron_sources "$RETIRE_OLLAMA_CRON_SOURCES"
  if package=$(dpkg-query -W "-f=$PACKAGE_FORMAT" ollama 2>/dev/null); then :; else die 'Ollama package missing'; fi; [ -n "$package" ] || die 'Ollama package missing'; record_scan package-identity dpkg-query -W "-f=$PACKAGE_FORMAT" ollama
  docker_socket_scan_end; record_docker_socket; record_scan docker-daemon docker --host "unix://$CANONICAL_DOCKER_SOCKET" info --format '{{.ServerVersion}} {{.Driver}} {{.DockerRootDir}}'
  if id=$(container_id 2>/dev/null); then image=$(docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect -f '{{.Image}}' "$CONTAINER") || die 'container image scan failed'; container_config; config=$CONTAINER_CONFIG_SHA; records=$(jq -cn --argjson old "$records" --arg id "$id" --arg image "$image" --arg config "$config" '$old + [{class:"container-config",fullId:$id,imageId:$image,configSha256:$config}]') || die 'container record failed'; elif [ "$phase" != delete_models ]; then die 'container missing'; else consumer_counts=$(jq -cn --argjson old "$consumer_counts" '$old + [{surface:"container-config",matchCount:0}]') || die 'container count record failed'; fi
  model_values=$(model_phase_values "$phase") || exit $?
  tree=$(printf '%s\n' "$model_values" | /usr/bin/sed -n '1p')
  bytes=$(printf '%s\n' "$model_values" | /usr/bin/sed -n '2p')
  case "$phase" in scan|delete_models) records=$(jq -cn --argjson old "$records" --arg tree "$tree" --arg bytes "$bytes" '$old + [{class:"model-store-identity",treeSha256:$tree,byteCount:$bytes}]') || die 'model record failed';; revalidate) :;; *) die 'unknown collection phase';; esac
  daemon_out=$(temp_path); daemon=$(digest_command "$daemon_out" docker-daemon-identity docker --host "unix://$CANONICAL_DOCKER_SOCKET" info --format '{{.ServerVersion}} {{.Driver}}'); rm -f "$daemon_out"; docker_socket_scan_end
  jq -S -n --arg unit "$UNIT" --arg timer "$TIMER" --arg unitState "$(unit_state "$UNIT")" --arg timerState "$(unit_state "$TIMER")" --arg package "$package" --arg cron "$cron_sha" --arg container "${id:-removed}" --arg image "${image:-removed}" --arg config "${config:-removed}" --arg socket "$CANONICAL_DOCKER_SOCKET" --arg daemon "$daemon" --arg model "$tree" --arg modelBytes "$bytes" --argjson records "$records" --argjson dependencies "$deps" --argjson consumerCounts "$consumer_counts" --argjson consumerEvidence "$consumer_evidence" '{units:[{name:$unit,state:$unitState},{name:$timer,state:$timerState}],packageVersion:$package,cronSha256:$cron,container:{name:"ollama-loopback",fullId:$container,imageId:$image,configSha256:$config},docker:{socketPath:$socket,daemonSha256:$daemon},model:{treeSha256:$model,byteCount:$modelBytes},records:$records,dependencies:$dependencies,consumerCounts:$consumerCounts,consumerEvidence:$consumerEvidence}' >"$tmp" || die 'snapshot serialization failed'
}
safe_receipt_parent() { [ -d "$1" ] && [ ! -L "$1" ] || die 'unsafe receipt parent'; mode=$(stat -c '%a' "$1") || die 'receipt parent mode scan failed'; case "$mode" in ''|*[!0-7]*) die 'invalid receipt parent mode';; esac; [ $((0$mode & 022)) -eq 0 ] || die 'writable receipt parent'; }
ensure_receipt_dir() { if [ -e "$RECEIPT_DIR" ] || [ -L "$RECEIPT_DIR" ]; then safe_dir "$RECEIPT_DIR" || die 'unsafe receipt directory'; return; fi; parent=$(dirname "$RECEIPT_DIR"); safe_receipt_parent "$parent"; mkdir "$RECEIPT_DIR" || die 'receipt directory creation failed'; chmod 0700 "$RECEIPT_DIR" || die 'receipt directory protection failed'; safe_dir "$RECEIPT_DIR" || die 'unsafe receipt directory'; fsync_dir "$parent"; }
pending_for() { target=$1; [ ! -L "$target" ] || die 'unsafe receipt target'; pending_target_state=absent; if [ -e "$target" ]; then safe_file "$target" || die 'unsafe receipt target'; pending_target_state=existing; fi; pending="$target.pending"; [ ! -e "$pending" ] && [ ! -L "$pending" ] || die 'partial receipt publication'; printf '%s|%s\n' "$pending" "$pending_target_state"; }
publish_pending() { pending=$1 target=$2 target_state=${3:-}; chmod 0600 "$pending" || die 'receipt protection failed'; pending_identity=$(stat -c '%d:%i:%f:%u:%g:%a' "$pending") || die 'receipt identity scan failed'; fsync_file "$pending" || die 'receipt sync failed'; fsync_dir "$RECEIPT_DIR" || die 'receipt directory sync failed'; case "$target_state" in absent) [ ! -e "$target" ] && [ ! -L "$target" ] || die 'receipt publication race'; /usr/bin/perl -e 'exit(link($ARGV[0],$ARGV[1]) ? 0 : 1)' "$pending" "$target" || die 'receipt publication race'; [ "$(stat -c '%d:%i:%f:%u:%g:%a' "$target")" = "$pending_identity" ] || die 'receipt publication identity changed'; fsync_file "$target" || die 'receipt publication sync failed'; rm -f "$pending" || die 'receipt cleanup failed'; fsync_dir "$RECEIPT_DIR" || die 'receipt publication sync failed';; existing) [ -f "$target" ] && [ ! -L "$target" ] || die 'receipt target became unsafe'; mv -T "$pending" "$target" || die 'receipt publication failed'; [ -f "$target" ] && [ ! -L "$target" ] || die 'receipt publication target unsafe'; [ "$(stat -c '%d:%i:%f:%u:%g:%a' "$target")" = "$pending_identity" ] || die 'receipt publication identity changed'; fsync_dir "$RECEIPT_DIR" || die 'receipt publication sync failed';; *) die 'receipt publication state unavailable';; esac; }
discard_pending() { rm -f "$1" || die 'receipt cleanup failed'; fsync_dir "$RECEIPT_DIR"; }
assert_no_pending_receipts() { for target in "$RECEIPT" "$RECEIPT_SHA" "$RECEIPT_DIR/pre-destructive.json" "$RECEIPT_DIR/pre-destructive.actions" "$RECEIPT_DIR/completion.json"; do [ ! -e "$target.pending" ] && [ ! -L "$target.pending" ] || die 'partial receipt publication'; done; }
write_receipt() {
  snapshot=$1; ensure_receipt_dir; assert_no_pending_receipts; receipt_spec=$(pending_for "$RECEIPT") || die 'receipt target unsafe'; receipt_pending=${receipt_spec%|*}; receipt_state=${receipt_spec##*|}; jq -S -n --slurpfile snapshot "$snapshot" '{schemaVersion:2,scan:$snapshot[0],rollbackNeeds:["unmount scheduled-work read-only binds","reinstall Ollama package","redownload models"],prePostDeltas:{preDestructive:null,postDestructive:null}}' >"$receipt_pending" || { discard_pending "$receipt_pending"; die 'receipt serialization failed'; }
  receipt_sha=$(sha "$receipt_pending") || { discard_pending "$receipt_pending"; die 'receipt digest failed'; }; sha_spec=$(pending_for "$RECEIPT_SHA") || { discard_pending "$receipt_pending"; die 'receipt digest target unsafe'; }; sha_pending=${sha_spec%|*}; sha_state=${sha_spec##*|}; printf '%s\n' "$receipt_sha" >"$sha_pending" || { discard_pending "$receipt_pending"; discard_pending "$sha_pending"; die 'receipt digest write failed'; }; publish_pending "$sha_pending" "$RECEIPT_SHA" "$sha_state"; publish_pending "$receipt_pending" "$RECEIPT" "$receipt_state"; printf '%s\n' "$receipt_sha"
}
scan() { root; if [ -z "${TEMP_ROOT:-}" ]; then init_temp_root; trap 'cleanup_temp' EXIT HUP INT TERM; fi; tmp=$(temp_path); collect "$tmp"; write_receipt "$tmp"; }
canonical_receipt_digest() { safe_dir "$RECEIPT_DIR" || die 'unsafe receipt directory'; assert_no_pending_receipts; if ! safe_file "$RECEIPT" || ! safe_file "$RECEIPT_SHA"; then die 'immutable canonical receipt required'; fi; digest=$(cat "$RECEIPT_SHA") || die 'receipt digest read failed'; case "$digest" in *[!0-9a-f]*|'') die 'receipt digest malformed';; esac; [ "${#digest}" -eq 64 ] || die 'receipt digest malformed'; [ "$(sha "$RECEIPT")" = "$digest" ] || die 'receipt drift'; printf '%s\n' "$digest"; }
canonical_receipt() { safe_file "$INVENTORY" || die 'immutable reviewed inventory required'; digest=$(canonical_receipt_digest); [ "$(jq -er '.receiptSha256' "$INVENTORY")" = "$digest" ] || die 'inventory does not bind receipt'; }
dependency_sha() { out=$(temp_path); jq -S -c '.scan.dependencies' "$RECEIPT" >"$out" || { rm -f "$out"; die 'dependency canonicalization failed'; }; sha "$out"; status=$?; rm -f "$out"; return "$status"; }
approved_dependency_sha() { jq -er '.approvedDependencySha256 | if type == "string" and test("^[0-9a-f]{64}$") then . else error("approvedDependencySha256 must be a lowercase SHA-256") end' "$INVENTORY"; }
approved_endpoint_classes() { jq -er '.approvedEndpointClasses | if type == "array" and sort == ["disabled","external-provider","ollama-loopback"] then . else error("approvedEndpointClasses must be the reviewed finite taxonomy") end' "$INVENTORY"; }
assert_approved_dependency_classes() {
  allowed=$(approved_endpoint_classes) || review_required 'approved endpoint classes required'
  jq -e --argjson allowed "$allowed" '.scan.dependencies | type == "array" and all(.[]; .["endpoint-class"] as $class | ($class | type == "string") and ($allowed | index($class) != null))' "$RECEIPT" >/dev/null || review_required 'unapproved dependency endpoint class'
}
assert_zero_consumers() {
  jq -e --argjson required '["systemd-definitions","reverse-proxy","compose-definitions","running-processes","running-containers","container-definitions","container-config"]' '.scan.consumerCounts as $counts | ($counts | type == "array") and all($required[]; . as $surface | [$counts[] | select(.surface == $surface)] as $entries | ($entries | length == 1) and ($entries[0].matchCount == 0)) and all($counts[]; if .surface == "current-crontab" or (.surface | startswith("system-cron")) or .surface == "user-crontab" then .matchCount == 0 else true end)' "$RECEIPT" >/dev/null || review_required 'retirement requires zero classified consumers'
}
receipt_scan_snapshot() { source=$1 target=$2; jq -S -e '.scan | if type == "object" then . else error("receipt scan snapshot required") end' "$source" >"$target" || die 'receipt scan snapshot invalid'; }
normalize_revalidation_snapshot() {
  source=$1 target=$2 action=$3
  case "$action" in
    install_crontab) filter='del(.cronSha256,.units[].state,.model) | .records |= map(select(.class != "systemd-timers" and .class != "running-processes" and .class != "running-containers" and .class != "model-store-identity"))';;
    disable_unit|remove_container) filter='del(.cronSha256,.units[].state,.model) | .records |= map(select(.class != "current-crontab" and .class != "systemd-timers" and .class != "running-processes" and .class != "running-containers" and .class != "model-store-identity"))';;
    delete_models) filter='del(.cronSha256,.units[].state,.container) | .records |= map(select(.class != "current-crontab" and .class != "systemd-timers" and .class != "running-processes" and .class != "running-containers" and .class != "container-definitions" and .class != "container-config"))';;
    *) die 'unknown revalidation action';;
  esac
  jq -S "$filter" "$source" >"$target" || die "normalization failed $action"
}
assert_postcondition() {
  action=$1
  case "$action" in
    install_crontab) out=$(temp_path); if crontab -u "$OWNER" -l >"$out" 2>/dev/null; then :; else status=$?; rm -f "$out"; die "crontab postcondition failed ($status)"; fi; [ "$(sha "$out")" = "$POST_CRON_SHA" ] || { rm -f "$out"; die 'crontab postcondition drift'; }; rm -f "$out";;
    disable_unit) if systemctl is-active --quiet "$UNIT" || systemctl is-active --quiet "$TIMER"; then die 'unit remains active'; fi; if systemctl is-enabled --quiet "$UNIT" || systemctl is-enabled --quiet "$TIMER"; then die 'unit remains enabled'; fi;;
    remove_container) if docker --host "unix://$CANONICAL_DOCKER_SOCKET" inspect "$CONTAINER" >/dev/null 2>&1; then die 'container remains or was replaced'; fi; if pgrep -f '[o]llama' >/dev/null; then die 'Ollama process remains'; fi;;
    delete_models) [ ! -e "$STORE" ] || die 'model deletion postcondition failed';;
    *) die 'unknown postcondition action';;
  esac
}
record_action() { action=$1; ensure_receipt_dir; target="$RECEIPT_DIR/pre-destructive.actions"; action_spec=$(pending_for "$target") || die 'action receipt target unsafe'; action_pending=${action_spec%|*}; action_state=${action_spec##*|}; [ ! -e "$target" ] || cat "$target" >"$action_pending" || { discard_pending "$action_pending"; die 'action receipt read failed'; }; printf '%s\n' "$action" >>"$action_pending" || { discard_pending "$action_pending"; die 'action receipt write failed'; }; publish_pending "$action_pending" "$target" "$action_state"; }
revalidate_before() { action=$1; case "$action" in delete_models) phase=delete_models;; *) phase=revalidate;; esac; tmp=$(temp_path); baseline=$(temp_path); collect "$tmp" "$phase"; receipt_scan_snapshot "$RECEIPT" "$baseline"; normalize_revalidation_snapshot "$baseline" "$tmp.old" "$action"; normalize_revalidation_snapshot "$tmp" "$tmp.new" "$action"; cmp -s "$tmp.old" "$tmp.new" || die "drift before $action"; rm -f "$tmp" "$baseline" "$tmp.old" "$tmp.new"; }
install_crontab() { tmp=$(temp_path); if crontab -u "$OWNER" -l >"$tmp.before" 2>/dev/null; then :; else status=$?; [ "$status" -eq 1 ] || die 'crontab read failed'; : >"$tmp.before"; fi; while IFS= read -r line || [ -n "$line" ]; do h=$(hash_text "$line"); case "$h" in "$OLLAMA_CRON_ONE"|"$OLLAMA_CRON_TWO") continue;; esac; printf '%s\n' "$line" >>"$tmp"; done <"$tmp.before"; [ "$(sha "$tmp")" = "$POST_CRON_SHA" ] || die 'unexpected post-retirement crontab'; crontab -u "$OWNER" "$tmp" || die 'crontab install failed'; rm -f "$tmp" "$tmp.before"; assert_postcondition install_crontab; }
disable_unit() { revalidate_before disable_unit; assert_scheduled_mutations_quiesced "$at_state" "$cron_state"; systemctl stop "$TIMER" "$UNIT" || die 'unit stop failed'; systemctl disable "$TIMER" "$UNIT" || die 'unit disable failed'; assert_postcondition disable_unit; }
remove_container() { id=$(jq -er '.scan.container.fullId' "$RECEIPT") || die 'container receipt missing'; [ "$(container_id)" = "$id" ] || die 'container replacement'; docker --host "unix://$CANONICAL_DOCKER_SOCKET" rm -f "$id" >/dev/null || die 'container removal failed'; assert_postcondition remove_container; }
delete_models() { [ "$(model_identity)" = "$(jq -er '.scan.model.treeSha256' "$RECEIPT")" ] || die 'model tree drift'; (cd "$(dirname "$STORE")" && find "./$(basename "$STORE")" -xdev -depth -delete) || die 'model deletion failed'; assert_postcondition delete_models; }
apply() {
  root; if [ -z "${TEMP_ROOT:-}" ]; then init_temp_root; trap 'cleanup_temp' EXIT HUP INT TERM; fi; canonical_receipt; [ "$(jq -er '.reviewStatus' "$INVENTORY")" = approved ] || review_required 'reviewed active inventory required'; assert_approved_dependency_classes
  assert_zero_consumers; jq -e '.scan.dependencies | type == "array" and length == 0' "$RECEIPT" >/dev/null || review_required 'retirement requires zero dependencies'; approved=$(approved_dependency_sha) || review_required 'independent dependency review required'; [ "$approved" = "$(dependency_sha)" ] || review_required 'independent dependency review required'; ensure_receipt_dir; load_cron_inventory_helper; load_at_quiescence_helper; reconcile_interrupted_at_quiescence
  [ ! -e "$RECEIPT_DIR/pre-destructive.json" ] && [ ! -e "$RECEIPT_DIR/pre-destructive.actions" ] && [ ! -e "$RECEIPT_DIR/completion.json" ] || die 'incomplete or completed retirement exists'; at_state=$(at_submission_state); if printf '%s\n' "$at_state" | jq -e '.scheduler=="absent"' >/dev/null; then die 'absent at scheduler cannot be quiesced'; fi; pre_spec=$(pending_for "$RECEIPT_DIR/pre-destructive.json") || die 'pre-destructive receipt target unsafe'; pre_pending=${pre_spec%|*}; pre_state=${pre_spec##*|}; jq -S -n --argjson at "$at_state" '{phase:"pre-destructive",atSubmissionRollback:$at,rollbackNeeds:["unmount scheduled-work read-only binds","reinstall Ollama package","redownload models"]}' >"$pre_pending" || { discard_pending "$pre_pending"; die 'pre-destructive receipt failed'; }; publish_pending "$pre_pending" "$RECEIPT_DIR/pre-destructive.json" "$pre_state"; pre=$(completion_metrics); record_action quiesce_at_submissions; quiesce_at_submissions "$at_state"
  revalidate_before install_crontab; cron_mutation_state >/dev/null || die 'cron mutation state scan failed'; record_action install_crontab; assert_at_submissions_quiesced "$at_state"; install_crontab; cron_state=$(cron_mutation_state); pre_spec=$(pending_for "$RECEIPT_DIR/pre-destructive.json") || die 'cron receipt target unsafe'; pre_pending=${pre_spec%|*}; pre_state=${pre_spec##*|}; jq -S --argjson cron "$cron_state" '. + {cronMutationRollback:$cron}' "$RECEIPT_DIR/pre-destructive.json" >"$pre_pending" || { discard_pending "$pre_pending"; die 'cron mutation receipt failed'; }; publish_pending "$pre_pending" "$RECEIPT_DIR/pre-destructive.json" "$pre_state"; record_action quiesce_cron_mutations; quiesce_cron_mutations "$cron_state"; assert_postcondition install_crontab
  revalidate_before disable_unit; record_action disable_unit; assert_scheduled_mutations_quiesced "$at_state" "$cron_state"; disable_unit
  revalidate_before remove_container; record_action remove_container; assert_scheduled_mutations_quiesced "$at_state" "$cron_state"; remove_container
  revalidate_before delete_models; record_action delete_models; assert_scheduled_mutations_quiesced "$at_state" "$cron_state"; delete_models
  post=$(completion_metrics)
  ensure_receipt_dir; completion_spec=$(pending_for "$RECEIPT_DIR/completion.json") || die 'completion receipt target unsafe'; completion_pending=${completion_spec%|*}; completion_state=${completion_spec##*|}; jq -S -n --arg receiptSha256 "$(canonical_receipt_digest)" --argjson at "$at_state" --argjson cron "$cron_state" --argjson pre "$pre" --argjson post "$post" '{receiptSha256:$receiptSha256,atSubmissionRollback:$at,cronMutationRollback:$cron,prePostDeltas:{preDestructive:$pre,postDestructive:$post,deltas:{cgroupMemoryBytes:($post.cgroupMemoryBytes-$pre.cgroupMemoryBytes),hostAvailableMemoryBytes:($post.hostAvailableMemoryBytes-$pre.hostAvailableMemoryBytes),modelStoreBytes:($post.modelStoreBytes-$pre.modelStoreBytes)}},rollbackNeeds:["unmount scheduled-work read-only binds","reinstall Ollama package","redownload models"]}' >"$completion_pending" || { discard_pending "$completion_pending"; die 'completion receipt failed'; }; publish_pending "$completion_pending" "$RECEIPT_DIR/completion.json" "$completion_state"
}
retirement_helpers() { load_cron_inventory_helper; load_at_quiescence_helper; load_consumer_scanners; }; retirement_lock() { if [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then lock=${RETIRE_OLLAMA_LOCK:-"${TMPDIR:-/tmp}/baci-cwv-retire-ollama.lock"}; lock_kind=file; flock=${RETIRE_OLLAMA_FLOCK:-/usr/bin/true}; else lock_dir=/run/lock/baci-cwv; if [ ! -e "$lock_dir" ]; then (umask 077; /bin/mkdir "$lock_dir") || [ -d "$lock_dir" ] || die 'retirement lock directory creation failed'; fi; [ -d "$lock_dir" ] && [ ! -L "$lock_dir" ] && [ "$(/usr/bin/stat -c '%u:%a' "$lock_dir")" = 0:700 ] && [ ! -e "$lock_dir/retire-ollama.lock" ] && [ ! -L "$lock_dir/retire-ollama.lock" ] || die 'retirement lock directory unsafe'; lock=$lock_dir; lock_kind=directory; flock=/usr/bin/flock; fi; if [ "$lock_kind" = directory ]; then exec 9<"$lock" || die 'retirement lock open failed'; else exec 9>"$lock" || die 'retirement lock open failed'; fi; "$flock" -n 9 || die 'another retirement operation owns the lock' 75; }; retirement_prepare() { init_temp_root; trap 'cleanup_temp' EXIT HUP INT TERM; retirement_helpers; retirement_lock; }; main() { case "${1:-}" in --scan) root; retirement_prepare; scan;; --apply) root; retirement_prepare; apply;; --recovery-scan) type recovery_scan >/dev/null 2>&1 || review_required 'recovery helper missing'; root; retirement_lock; recovery_scan;; *) usage;; esac; }
case "$0" in */retire-ollama.sh|retire-ollama.sh) main "$@";; esac
