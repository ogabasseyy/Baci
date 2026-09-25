#!/bin/sh
# Shared finite cron-source discovery for the privileged retirement and recovery scans.
cron_inventory_override_or_default() {
  value=$1 default=$2
  if [ "$(id -u)" -eq 0 ] || [ -z "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then
    printf '%s\n' "$default"
  else
    printf '%s\n' "${value:-$default}"
  fi
}
cron_inventory_system_file() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_SYSTEM_FILE:-}" /etc/crontab; }
cron_inventory_system_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_SYSTEM_DIR:-}" /etc/cron.d; }
cron_inventory_spool_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_SPOOL_DIR:-}" /var/spool/cron/crontabs; }
cron_inventory_anacrontab() { cron_inventory_override_or_default "${RETIRE_OLLAMA_ANACRONTAB:-}" /etc/anacrontab; }
cron_inventory_hourly_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_HOURLY_DIR:-}" /etc/cron.hourly; }
cron_inventory_daily_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_DAILY_DIR:-}" /etc/cron.daily; }
cron_inventory_weekly_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_WEEKLY_DIR:-}" /etc/cron.weekly; }
cron_inventory_monthly_dir() { cron_inventory_override_or_default "${RETIRE_OLLAMA_CRON_MONTHLY_DIR:-}" /etc/cron.monthly; }
cron_inventory_at_absence_root() { cron_inventory_override_or_default "${RETIRE_OLLAMA_AT_ABSENCE_ROOT:-}" ''; }
cron_inventory_at_scheduler_absent() { at_root=$(cron_inventory_at_absence_root); for suffix in /usr/bin/at /usr/bin/atq /usr/bin/atrm /usr/sbin/atd /etc/init.d/atd /etc/systemd/system/atd.service /lib/systemd/system/atd.service /usr/lib/systemd/system/atd.service /var/spool/cron/atjobs /var/spool/cron/atspool /var/spool/at /var/spool/atjobs /var/spool/atspool; do at_path=$at_root$suffix; [ ! -e "$at_path" ] && [ ! -L "$at_path" ] || return 1; done; }
cron_inventory_require_empty_at_queue() { if [ "$(id -u)" -eq 0 ] || [ -z "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then atq=/usr/bin/atq; else atq=${RETIRE_OLLAMA_ATQ:-/usr/bin/true}; fi; if [ ! -e "$atq" ] && [ ! -L "$atq" ]; then cron_inventory_at_scheduler_absent; return $?; fi; cron_inventory_real_file "$atq" && [ -x "$atq" ] || return 1; at_snapshot=$(temp_path); "$atq" >"$at_snapshot" 2>/dev/null || { rm -f "$at_snapshot"; return 1; }; [ ! -s "$at_snapshot" ]; at_status=$?; rm -f "$at_snapshot"; return "$at_status"; }
cron_inventory_valid_name() { case "$1" in ''|.*|*[!A-Za-z0-9_.-]*) return 1;; *) return 0;; esac; }
cron_inventory_run_parts_name() { case "$1" in ''|.*|*[!A-Za-z0-9_-]*) return 1;; *) return 0;; esac; }
cron_inventory_real_file() {
  path=$1; [ -f "$path" ] && [ ! -L "$path" ] || return 1
  real=$(readlink -f -- "$path") || return 1
  [ "$real" = "$path" ]
}
cron_inventory_system_file_ok() {
  path=$1; cron_inventory_real_file "$path" || return 1
  identity=$(stat -c '%u:%a' "$path") || return 1
  IFS=: read -r uid mode <<EOF
$identity
EOF
  case "$uid:$mode" in 0:[0-7][0-7][0-7]) :;; *) return 1;; esac
  [ $((0$mode & 022)) -eq 0 ]
}
cron_inventory_system_dir_ok() {
  path=$1; [ -d "$path" ] && [ ! -L "$path" ] || return 1
  real=$(readlink -f -- "$path") || return 1; [ "$real" = "$path" ] || return 1
  identity=$(stat -c '%u:%a' "$path") || return 1
  IFS=: read -r uid mode <<EOF
$identity
EOF
  case "$uid:$mode" in 0:[0-7][0-7][0-7]) :;; *) return 1;; esac
  [ $((0$mode & 022)) -eq 0 ]
}
cron_inventory_spool_dir_ok() {
  path=$1; [ -d "$path" ] && [ ! -L "$path" ] || return 1
  real=$(readlink -f -- "$path") || return 1; [ "$real" = "$path" ] || return 1
  expected_gid=$(cron_inventory_crontab_gid) || return 1
  identity=$(stat -c '%u:%g:%a' "$path") || return 1
  IFS=: read -r uid gid mode <<EOF
$identity
EOF
  [ "$uid:$gid:$mode" = "0:$expected_gid:1730" ]
}
cron_inventory_single_nss_record() {
  database=$1 key=$2; row=$(getent "$database" "$key") || return 1
  case "$row" in *'
'*) return 1;; esac
  printf '%s\n' "$row"
}
cron_inventory_crontab_gid() {
  row=$(cron_inventory_single_nss_record group crontab) || return 1
  IFS=: read -r name _ gid members extra <<EOF
$row
EOF
  [ -z "${extra:-}" ] && [ -z "$members" ] && [ "$name" = crontab ] || return 1
  case "$gid" in ''|*[!0-9]*) return 1;; esac
  printf '%s\n' "$gid"
}
cron_inventory_account_uid() {
  account=$1; cron_inventory_valid_name "$account" || return 1
  row=$(cron_inventory_single_nss_record passwd "$account") || return 1
  IFS=: read -r name _ uid gid _ _ _ extra <<EOF
$row
EOF
  [ -z "${extra:-}" ] && [ "$name" = "$account" ] || return 1
  case "$uid:$gid" in *[!0-9:]*|:*) return 1;; esac
  printf '%s\n' "$uid"
}
cron_inventory_user_file_ok() {
  account=$1 path=$2; cron_inventory_real_file "$path" || return 1
  expected=$(cron_inventory_account_uid "$account") || return 1
  identity=$(stat -c '%u:%a' "$path") || return 1
  IFS=: read -r uid mode <<EOF
$identity
EOF
  { [ "$uid" = "$expected" ] || [ "$uid" = 0 ]; } && [ "$mode" = 600 ]
}
cron_inventory_periodic_file_ok() {
  path=$1; cron_inventory_system_file_ok "$path" && [ -x "$path" ]
}
cron_inventory_optional_system_file() {
  path=$1 output=$2
  [ ! -e "$path" ] && [ ! -L "$path" ] && return 0
  cron_inventory_system_file_ok "$path" || return 1
  printf 'system\t-\t%s\n' "$path" >>"$output"
}
cron_inventory_periodic_dir() {
  directory=$1 output=$2
  [ ! -e "$directory" ] && [ ! -L "$directory" ] && return 0
  cron_inventory_system_dir_ok "$directory" || return 1
  count=0
  for path in "$directory"/*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    name=${path##*/}; cron_inventory_run_parts_name "$name" || return 1
    cron_inventory_periodic_file_ok "$path" || return 1
    count=$((count + 1)); [ "$count" -le 256 ] || return 1
    printf 'system-directory\t-\t%s\n' "$path" >>"$output" || return 1
  done
}
cron_inventory_command_targets() {
  kind=$1 source=$2 snapshot=$3; anacron=$(cron_inventory_anacrontab); system=$(cron_inventory_system_file); cron_target_system_dir=$(cron_inventory_system_dir); hourly=$(cron_inventory_hourly_dir); daily=$(cron_inventory_daily_dir); weekly=$(cron_inventory_weekly_dir); monthly=$(cron_inventory_monthly_dir)
  case "$kind:$source" in system:"$anacron") format=anacron;; system:*) format=system;; user:*) format=user;; system-directory:*) cron_parent=${source%/*}; if [ "$cron_parent" = "$cron_target_system_dir" ]; then format=system; else case "$cron_parent" in "$hourly"|"$daily"|"$weekly"|"$monthly") printf 'command\t%s\n' "$source"; return 0;; *) return 0;; esac; fi;; *) return 2;; esac
  [ "$kind:$source" = "system:$system" ] && canonical_system=1 || canonical_system=0
  awk -v format="$format" -v canonical_system="$canonical_system" -v hourly="$hourly" -v daily="$daily" -v weekly="$weekly" -v monthly="$monthly" '
    function fixed_periodic(directory) {
      return directory == hourly || directory == daily || directory == weekly || directory == monthly
    }
    function periodic_delegation(field, directory) {
      if (!canonical_system || format != "system" || $(field - 1) != "root") return 0
      if (NF == field + 5 && $field == "cd" && $(field + 1) == "/" && $(field + 2) == "&&" && $(field + 3) == "run-parts" && $(field + 4) == "--report") return fixed_periodic($(field + 5))
      return NF == field + 11 && $field == "test" && $(field + 1) == "-x" && $(field + 2) == "/usr/sbin/anacron" && $(field + 3) == "||" && $(field + 4) == "(" && $(field + 5) == "cd" && $(field + 6) == "/" && $(field + 7) == "&&" && $(field + 8) == "run-parts" && $(field + 9) == "--report" && $(field + 11) == ")" && fixed_periodic($(field + 10))
    }
    function safe_absolute(value) { return value ~ /^\/[-A-Za-z0-9._+@%=]+(\/[-A-Za-z0-9._+@%=]+)*$/ && value !~ /(^|\/)\.\.?($|\/)/ }
    function unsafe_interpreter(value) { return value ~ /\/(sh|bash|dash|env|node|perl|php|python|python[0-9.]*|ruby)$/ }
    function argument(value, path) {
      path=value; if (value ~ /^--?[A-Za-z0-9][A-Za-z0-9-]*=/) sub(/^[^=]*=/, "", path)
      if (path ~ /^\//) { if (!safe_absolute(path)) bad=1; else print "file\t" path }
      else if (path ~ /^\.\.?\//) bad=1
    }
    function direct(field, command, i) {
      if (NF < field) { bad=1; return }
      command=$field
      if (!safe_absolute(command) || unsafe_interpreter(command)) { bad=1; return }
      for (i=field+1; i<=NF; i++) if ($i ~ /[;&|<>()`$\\%]/) { bad=1; return }
      if (command == "/usr/bin/flock") { if (NF < field + 3 || $(field + 1) != "-n" || $(field + 2) !~ /^\/run\// || !safe_absolute($(field + 2)) || !safe_absolute($(field + 3)) || unsafe_interpreter($(field + 3))) { bad=1; return }; print "command\t" $(field + 3); for (i=field+4; i<=NF; i++) argument($i); return }
      print "command\t" command
      for (i=field+1; i<=NF; i++) argument($i)
    }
    /^[[:space:]]*($|#)/ { next }
    /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/ { name=$0; sub(/=.*/,"",name); sub(/^[[:space:]]*/,"",name); value=$0; sub(/^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*/,"",value); quote=substr(value,1,1); if((quote=="\""||quote=="\047")&&substr(value,length(value),1)==quote)value=substr(value,2,length(value)-2); if(name=="PATH"||name=="HOME")next; if(value~/^\//){if(!safe_absolute(value))bad=1;else print "file\t" value}else if(value~/[\/\\`$]/)bad=1; next }
    {
      if (periodic_delegation(7)) next
      if ($0 ~ /[;&|<>()`$\\%]/) { bad=1; next }
      if ($1 ~ /^@[A-Za-z]+$/) { direct(format == "system" ? 3 : 2); next }
      direct(format == "system" ? 7 : (format == "anacron" ? 4 : 6))
    }
    END { exit bad ? 2 : 0 }
  ' "$snapshot"
}
cron_inventory_wrapper_source_paths() {
  awk '
    function trim(value) { sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value); return value }
    {
      line=trim($0)
      if (line == "" || line ~ /^#/) next
      if (line ~ /^(\.|source)([[:space:]]|$)/) {
        sub(/^(\.|source)[[:space:]]+/, "", line)
        sub(/[[:space:]]+#.*$/, "", line)
        if (line !~ /^\/[A-Za-z0-9._\/-]+$/ || line ~ /(^|\/)\.\.?($|\/)/) bad=1
        else print line
      }
    }
    END { exit bad ? 2 : 0 }
  ' "$1"
}
cron_inventory_wrapper_exec_paths() {
  if grep -q -Ei 'ollama|11434' "$1"; then wrapper_bound=1; else status=$?; [ "$status" -eq 1 ] || return "$status"; wrapper_bound=0; fi
  awk -v wrapper_bound="$wrapper_bound" '
    function trim(value) { sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value); return value } function safe(path) { return path ~ /^\/[A-Za-z0-9._\/-]+$/ && path !~ /(^|\/)\.\.?($|\/)/ } function builtin(line) { return line ~ /^(exit([[:space:]]+[0-9]+)?|true|false|:|set[[:space:]]+-[A-Za-z]+)$/ }
    function emit(token, path) {
      path=token; if (token ~ /^--?[A-Za-z0-9][A-Za-z0-9-]*=/) sub(/^[^=]*=/, "", path)
      if (path ~ /^\//) { if (!safe(path)) bad=1; else print path }
      else if (path ~ /^\.\.?\//) bad=1
    }
    function paths(line, count, parts, i) {
      sub(/[[:space:]]+#.*$/, "", line)
      if (line ~ /[\\\047"`$|&;<>(){}]/) { bad=1; return }
      count=split(line, parts, /[[:space:]]+/)
      if (count < 1 || !safe(parts[1])) { bad=1; return }
      for (i=1; i<=count; i++) emit(parts[i])
    }
    function assigned(line, count, parts, i, value) {
      sub(/[[:space:]]+#.*$/, "", line)
      if (line ~ /[\\\047"`$|&;<>(){}]/) { bad=1; return }
      count=split(line, parts, /[[:space:]]+/)
      i=1
      while (i<=count && parts[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=[-A-Za-z0-9._+@%\/:,=]*$/) {
        value=parts[i]; sub(/^[^=]*=/, "", value)
        if (value ~ /^\//) { if (!safe(value)) bad=1; else print value }
        else if (value ~ /^\.\.?\//) bad=1
        i++
      }
      if (i == 1) { bad=1; return }
      if (i > count) return
      if (!safe(parts[i])) { bad=1; return }
      for (; i<=count; i++) emit(parts[i])
    }
    function guarded(line, count, parts, target) {
      count=split(line, parts, /[[:space:]]+/); target=parts[7]
      if (target !~ /;$/) { bad=1; return }; sub(/;$/, "", target)
      if (count != 8 || parts[1] != "if" || parts[2] != "[" || parts[3] != "-f" || parts[5] != "];" || parts[6] != "then" || parts[8] != "fi" || !safe(parts[4]) || !safe(target)) { bad=1; return }
      print target
    }
    {
      line=trim($0)
      if (line == "" || line ~ /^#/) next
      if (line ~ /^exec[[:space:]]+/) { sub(/^exec[[:space:]]+/, "", line); paths(line) }
      else if (line ~ /^\//) paths(line)
      else if (line ~ /^[A-Za-z_][A-Za-z0-9_]*=/) assigned(line)
      else if (line ~ /^if([[:space:]]|$)/) guarded(line)
      else if (line ~ /^(\.|source)([[:space:]]|$)/ || builtin(line)) next
      else if (line ~ /(^|;)[[:space:]]*exec[[:space:]]/ || line ~ /^(then|else|elif|fi|case|esac|for|while|until|do|done)([[:space:]]|$)/ || line ~ /[\\\047"`$|&;<>(){}]/ || !wrapper_bound) bad=1
    }
    END { exit bad ? 2 : 0 }
  ' "$1"
}
cron_inventory_record_wrapper_closure() {
  cron_wrapper_class=$1 cron_wrapper_initial=$2; cron_wrapper_queue=$(temp_path); cron_wrapper_seen=$(temp_path); cron_wrapper_bound=$(temp_path)
  printf '%s\n' "$cron_wrapper_initial" >"$cron_wrapper_queue" || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }
  cron_wrapper_count=0
  while IFS= read -r cron_wrapper_path || [ -n "$cron_wrapper_path" ]; do
    cron_wrapper_path=$(consumer_canonical_regular "$cron_wrapper_path") || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }
    if grep -Fqx -- "$cron_wrapper_path" "$cron_wrapper_seen" >/dev/null 2>&1; then continue; else cron_wrapper_status=$?; [ "$cron_wrapper_status" -eq 1 ] || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return "$cron_wrapper_status"; }; fi
    printf '%s\n' "$cron_wrapper_path" >>"$cron_wrapper_seen" || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }
    cron_wrapper_count=$((cron_wrapper_count + 1)); [ "$cron_wrapper_count" -le 256 ] || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }
    cron_wrapper_captured=$(consumer_snapshot "$cron_wrapper_path") || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }; cron_wrapper_snapshot=${cron_wrapper_captured%%|*}; cron_wrapper_identity=${cron_wrapper_captured#*|}
    cron_wrapper_content=$(sha "$cron_wrapper_snapshot") || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot"; return 2; }
    records=$(jq -cn --argjson old "$records" --arg class "$cron_wrapper_class-command" --arg path "$cron_wrapper_path" --arg sha "$cron_wrapper_content" --arg identity "$cron_wrapper_identity" '$old + [{class:$class,realPath:$path,sha256:$sha,identitySha256:$identity}]') || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot"; return 2; }
    record_consumers "$cron_wrapper_class" "$cron_wrapper_snapshot" cron-unapproved || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot"; return 2; }
    cron_wrapper_sources=$(temp_path); cron_wrapper_execs=$(temp_path); cron_inventory_wrapper_source_paths "$cron_wrapper_snapshot" >"$cron_wrapper_sources" || { cron_wrapper_status=$?; rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return "$cron_wrapper_status"; }
    if [ "$(dd if="$cron_wrapper_snapshot" bs=2 count=1 2>/dev/null)" = '#!' ]; then cron_inventory_wrapper_exec_paths "$cron_wrapper_snapshot" >"$cron_wrapper_execs" || { cron_wrapper_status=$?; rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return "$cron_wrapper_status"; }; fi
    while IFS= read -r cron_wrapper_source || [ -n "$cron_wrapper_source" ]; do cron_wrapper_source=$(consumer_canonical_regular "$cron_wrapper_source") || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }; printf '%s\n' "$cron_wrapper_source" >>"$cron_wrapper_queue" || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }; done <"$cron_wrapper_sources"
    while IFS= read -r cron_wrapper_exec || [ -n "$cron_wrapper_exec" ]; do cron_wrapper_exec=$(consumer_canonical_regular "$cron_wrapper_exec") || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }; printf '%s\n' "$cron_wrapper_exec" >>"$cron_wrapper_queue" || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }; done <"$cron_wrapper_execs"
    consumer_canonical_regular "$cron_wrapper_path" >/dev/null && [ "$cron_wrapper_identity" = "$(consumer_source_identity "$cron_wrapper_path")" ] || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }
    printf '%s\t%s\n' "$cron_wrapper_path" "$cron_wrapper_identity" >>"$cron_wrapper_bound" || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound" "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"; return 2; }
    rm -f "$cron_wrapper_snapshot" "$cron_wrapper_sources" "$cron_wrapper_execs"
  done <"$cron_wrapper_queue"
  cron_wrapper_tab=$(printf '\t')
  while IFS="$cron_wrapper_tab" read -r cron_wrapper_path cron_wrapper_identity || [ -n "$cron_wrapper_path$cron_wrapper_identity" ]; do consumer_canonical_regular "$cron_wrapper_path" >/dev/null && [ "$cron_wrapper_identity" = "$(consumer_source_identity "$cron_wrapper_path")" ] || { rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"; return 2; }; done <"$cron_wrapper_bound"
  rm -f "$cron_wrapper_queue" "$cron_wrapper_seen" "$cron_wrapper_bound"
}
cron_inventory_record_wrapper_consumers() {
  class=$1 kind=$2 source=$3 snapshot=$4; targets=$(temp_path)
  cron_inventory_command_targets "$kind" "$source" "$snapshot" >"$targets" || { rm -f "$targets"; return 2; }
  cron_target_tab=$(printf '\t')
  while IFS="$cron_target_tab" read -r target_kind target || [ -n "$target_kind$target" ]; do
    [ -n "$target" ] || { target=$target_kind; target_kind='command'; }; case "$target_kind" in command|file) :;; *) rm -f "$targets"; return 2;; esac
    target=$(consumer_canonical_regular "$target") || { rm -f "$targets"; return 2; }; [ "$target_kind" = file ] || [ -x "$target" ] || { rm -f "$targets"; return 2; }
    cron_inventory_record_wrapper_closure "$class" "$target" || { cron_wrapper_status=$?; rm -f "$targets"; return "$cron_wrapper_status"; }
  done <"$targets"
  rm -f "$targets"
}
cron_inventory_collect_external() {
  output=$1; : >"$output" || die 'cron inventory output failed'
  cron_inventory_require_empty_at_queue || die 'queued at work or unsafe at queue'
  system=$(cron_inventory_system_file); cron_inventory_system_file_ok "$system" || die 'unsafe system crontab'
  printf 'system\t-\t%s\n' "$system" >>"$output" || die 'cron inventory output failed'
  system_dir=$(cron_inventory_system_dir); cron_inventory_system_dir_ok "$system_dir" || die 'unsafe system cron directory'
  count=0
  for path in "$system_dir"/*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    name=${path##*/}; cron_inventory_valid_name "$name" || die 'unsafe system cron entry'
    cron_inventory_system_file_ok "$path" || die 'unsafe system cron entry'
    count=$((count + 1)); [ "$count" -le 256 ] || die 'too many system cron entries'
    printf 'system-directory\t-\t%s\n' "$path" >>"$output" || die 'cron inventory output failed'
  done
  cron_inventory_optional_system_file "$(cron_inventory_anacrontab)" "$output" || die 'unsafe anacrontab'
  cron_inventory_periodic_dir "$(cron_inventory_hourly_dir)" "$output" || die 'unsafe hourly cron directory'
  cron_inventory_periodic_dir "$(cron_inventory_daily_dir)" "$output" || die 'unsafe daily cron directory'
  cron_inventory_periodic_dir "$(cron_inventory_weekly_dir)" "$output" || die 'unsafe weekly cron directory'
  cron_inventory_periodic_dir "$(cron_inventory_monthly_dir)" "$output" || die 'unsafe monthly cron directory'
  spool=$(cron_inventory_spool_dir); cron_inventory_spool_dir_ok "$spool" || die 'unsafe cron spool directory'
  count=0
  for path in "$spool"/*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    account=${path##*/}; cron_inventory_valid_name "$account" || die 'unsafe cron spool entry'
    cron_inventory_user_file_ok "$account" "$path" || die 'unbound cron spool entry'
    count=$((count + 1)); [ "$count" -le 256 ] || die 'too many cron spool entries'
    [ "$account" = "$OWNER" ] && continue
    printf 'user\t%s\t%s\n' "$account" "$path" >>"$output" || die 'cron inventory output failed'
  done
  cron_inventory_require_empty_at_queue || die 'queued at work or unsafe at queue'
}
record_external_cron_sources() {
  supplied_manifest=${1:-}; manifest_owned=0; if [ -n "$supplied_manifest" ]; then manifest=$supplied_manifest; else manifest=$(temp_path); cron_inventory_collect_external "$manifest"; manifest_owned=1; fi
  load_consumer_scanners; manifest_captured=$(consumer_snapshot "$manifest") || die 'unsafe cron inventory manifest'; manifest_snapshot=${manifest_captured%%|*}; manifest_identity=${manifest_captured#*|}
  while IFS="$(printf '\t')" read -r kind account path || [ -n "$kind$account$path" ]; do
    case "$kind" in system) class='system-crontab';; system-directory) class='system-cron-directory';; user) class='user-crontab';; *) rm -f "$manifest_snapshot"; die 'invalid cron inventory entry';; esac
    [ -n "$path" ] || { rm -f "$manifest_snapshot"; die 'invalid cron inventory entry'; }
    load_consumer_scanners; real=$(consumer_canonical_regular "$path") || { rm -f "$manifest_snapshot"; die 'unsafe cron source'; }; captured=$(consumer_snapshot "$path") || { rm -f "$manifest_snapshot"; die 'cron source capture failed'; }; snapshot=${captured%%|*}; identity=${captured#*|}; [ "$identity" = "$(consumer_source_identity "$path")" ] && [ "$real" = "$(consumer_canonical_regular "$path")" ] || { rm -f "$manifest_snapshot" "$snapshot"; die 'cron source changed during capture'; }; content=$(sha "$snapshot"); records=$(jq -cn --argjson old "$records" --arg class "$class" --arg path "$real" --arg sha "$content" --arg identity "$identity" '$old + [{class:$class,realPath:$path,sha256:$sha,identitySha256:$identity}]') || { rm -f "$manifest_snapshot" "$snapshot"; die 'cron source record failed'; }; record_consumers "$class" "$snapshot" cron-unapproved || { rm -f "$manifest_snapshot" "$snapshot"; die 'cron source consumer scan failed'; }; cron_inventory_record_wrapper_consumers "$class" "$kind" "$path" "$snapshot" || { rm -f "$manifest_snapshot" "$snapshot"; die 'unsafe cron command target'; }; [ "$identity" = "$(consumer_source_identity "$path")" ] && [ "$real" = "$(consumer_canonical_regular "$path")" ] || { rm -f "$manifest_snapshot" "$snapshot"; die 'cron source changed during capture'; }; rm -f "$snapshot"
  done <"$manifest_snapshot"
  consumer_canonical_regular "$manifest" >/dev/null && [ "$manifest_identity" = "$(consumer_source_identity "$manifest")" ] || { rm -f "$manifest_snapshot"; die 'cron inventory manifest changed'; }
  rm -f "$manifest_snapshot"; [ "$manifest_owned" -eq 0 ] || rm -f "$manifest"
}
