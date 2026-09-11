#!/bin/sh

at_submission_mount_state() {
  if value=$(/usr/bin/findmnt -rn --vfs-all --mountpoint "$AT_JOB_DIR" -o TARGET,VFS-OPTIONS 2>/dev/null); then
    case "$value" in
      "$AT_JOB_DIR "*) options=${value#"$AT_JOB_DIR "} ;;
      *) die 'at submission mount state invalid' ;;
    esac
    case ",$options," in
      *,ro,*) printf '%s\n' ro ;;
      *,rw,*) printf '%s\n' rw ;;
      *) die 'at submission mount options invalid' ;;
    esac
  else
    status=$?
    [ "$status" -eq 1 ] || die 'at submission mount inspection failed'
    printf '%s\n' absent
  fi
}

at_create_bind_mount() {
  /usr/bin/mount --bind "$AT_JOB_DIR" "$AT_JOB_DIR" ||
    die 'at submission bind mount failed'
}

at_remount_bind_readonly() {
  /usr/bin/mount -o remount,bind,ro "$AT_JOB_DIR" "$AT_JOB_DIR" ||
    die 'at submission read-only remount failed'
}

at_unmount_submission_spool() {
  /usr/bin/umount "$AT_JOB_DIR" || die 'at submission unmount failed'
}

# shellcheck disable=SC2086 # The validated stat record is intentionally split on colon.
at_submission_state() {
  if type cron_inventory_at_scheduler_absent >/dev/null 2>&1 &&
    cron_inventory_at_scheduler_absent; then
    jq -cn '{scheduler:"absent"}'
    return
  fi
  at_dir=$AT_JOB_DIR
  at_sequence=$at_dir/.SEQ
  [ -d "$at_dir" ] && [ ! -L "$at_dir" ] &&
    [ "$(CDPATH='' cd -- "$at_dir" && pwd -P)" = "$at_dir" ] ||
    die 'unsafe at submission spool'
  [ "$(at_submission_mount_state)" = absent ] ||
    die 'at submission spool already mounted'
  [ -f "$at_sequence" ] && [ ! -L "$at_sequence" ] ||
    die 'unsafe at sequence file'
  at_state=$(stat -c '%d:%i:%u:%g:%a' "$at_dir") ||
    die 'at submission spool identity failed'
  at_sequence_state=$(stat -c '%d:%i:%u:%g:%a' "$at_sequence") ||
    die 'at sequence identity failed'
  old_ifs=$IFS
  IFS=:
  set -- $at_state
  IFS=$old_ifs
  [ "$#" -eq 5 ] && [ "$5" = 1770 ] &&
    [ "${at_sequence_state#*:*:}" = "$3:$4:600" ] ||
    die 'at submission spool contract drift'
  jq -cn --arg path "$at_dir" --arg identity "$1:$2:$3:$4" \
    --arg sequenceIdentity "${at_sequence_state%:600}" \
    '{path:$path,identity:$identity,sequenceIdentity:$sequenceIdentity,originalMountState:"absent",quiescedMountState:"ro-bind"}'
}

assert_at_submission_identity() {
  at_expected=$1
  if printf '%s\n' "$at_expected" | jq -e 'type=="object" and .scheduler=="absent" and length==1' >/dev/null; then
    cron_inventory_at_scheduler_absent || die 'at scheduler absence drift'
    return
  fi
  at_path=$(printf '%s\n' "$at_expected" | jq -er '.path') ||
    die 'at rollback state invalid'
  at_identity=$(printf '%s\n' "$at_expected" | jq -er '.identity') ||
    die 'at rollback state invalid'
  at_sequence_identity=$(printf '%s\n' "$at_expected" | jq -er '.sequenceIdentity') ||
    die 'at rollback state invalid'
  [ "$at_path" = "$AT_JOB_DIR" ] &&
    [ "$(stat -c '%d:%i:%u:%g:%a' "$at_path")" = "$at_identity:1770" ] &&
    [ -f "$at_path/.SEQ" ] && [ ! -L "$at_path/.SEQ" ] &&
    [ "$(stat -c '%d:%i:%u:%g:%a' "$at_path/.SEQ")" = "$at_sequence_identity:600" ] ||
    die 'at submission identity drift'
}

assert_at_submissions_quiesced() {
  at_expected=$1
  assert_at_submission_identity "$at_expected"
  if printf '%s\n' "$at_expected" | jq -e '.scheduler=="absent"' >/dev/null; then
    [ "$(at_submission_mount_state)" = absent ] &&
      cron_inventory_require_empty_at_queue || die 'at scheduler absence drift'
    return
  fi
  [ "$(at_submission_mount_state)" = ro ] ||
    die 'at submission quiescence drift'
  cron_inventory_require_empty_at_queue || die 'queued work or an unsafe queue'
}

quiesce_at_submissions() {
  at_expected=$1
  [ "$(at_submission_state)" = "$at_expected" ] ||
    die 'at submission spool changed'
  if printf '%s\n' "$at_expected" | jq -e '.scheduler=="absent"' >/dev/null; then
    die 'absent at scheduler cannot be quiesced'
  fi
  at_create_bind_mount
  [ "$(at_submission_mount_state)" = rw ] ||
    die 'at submission bind mount state invalid'
  assert_at_submission_identity "$at_expected"
  at_remount_bind_readonly
  assert_at_submissions_quiesced "$at_expected"
}

cron_mutation_mount_state() {
  cron_mount_path=$1
  if cron_mount_value=$(/usr/bin/findmnt -rn --vfs-all --mountpoint "$cron_mount_path" -o TARGET,VFS-OPTIONS 2>/dev/null); then
    case "$cron_mount_value" in "$cron_mount_path "*) cron_mount_options=${cron_mount_value#"$cron_mount_path "};; *) die 'cron mutation mount state invalid';; esac
    case ",$cron_mount_options," in *,ro,*) printf '%s\n' ro;; *,rw,*) printf '%s\n' rw;; *) die 'cron mutation mount options invalid';; esac
  else
    cron_mount_status=$?; [ "$cron_mount_status" -eq 1 ] || die 'cron mutation mount inspection failed'; printf '%s\n' absent
  fi
}

cron_mutation_surface_paths() {
  type cron_inventory_system_file >/dev/null 2>&1 || load_cron_inventory_helper
  cron_path=$(cron_inventory_system_file); cron_inventory_system_file_ok "$cron_path" || die 'unsafe system crontab'; printf 'file\t%s\n' "$cron_path"
  cron_path=$(cron_inventory_system_dir); cron_inventory_system_dir_ok "$cron_path" || die 'unsafe system cron directory'; printf 'directory\t%s\n' "$cron_path"
  cron_path=$(cron_inventory_spool_dir); cron_inventory_spool_dir_ok "$cron_path" || die 'unsafe cron spool directory'; printf 'directory\t%s\n' "$cron_path"
  cron_path=$(cron_inventory_anacrontab); [ -e "$cron_path" ] || [ -L "$cron_path" ] || die 'absent anacrontab cannot be quiesced'; cron_inventory_system_file_ok "$cron_path" || die 'unsafe anacrontab'; printf 'file\t%s\n' "$cron_path"
  for cron_path in "$(cron_inventory_hourly_dir)" "$(cron_inventory_daily_dir)" "$(cron_inventory_weekly_dir)" "$(cron_inventory_monthly_dir)"; do [ -e "$cron_path" ] || [ -L "$cron_path" ] || die 'absent periodic cron directory cannot be quiesced'; cron_inventory_system_dir_ok "$cron_path" || die 'unsafe periodic cron directory'; printf 'directory\t%s\n' "$cron_path"; done
}

cron_mutation_identity() { stat -c '%d:%i:%f:%u:%g:%a' "$1" || die 'cron mutation identity failed'; }
cron_mutation_digest() { if [ "$1" = file ]; then sha "$2"; else printf '%s\n' directory; fi; }
cron_unmount_mutation_surface() { /usr/bin/umount "$1" || die 'cron mutation rollback unmount failed'; }

cron_mutation_state() {
  cron_state_paths=$(temp_path); cron_mutation_surface_paths >"$cron_state_paths" || die 'cron mutation surface discovery failed'
  cron_state='[]'; cron_tab=$(printf '\t')
  while IFS="$cron_tab" read -r cron_kind cron_path || [ -n "$cron_kind$cron_path" ]; do
    case "$cron_kind" in file) [ -f "$cron_path" ] && [ ! -L "$cron_path" ] || die 'cron mutation file drift';; directory) [ -d "$cron_path" ] && [ ! -L "$cron_path" ] || die 'cron mutation directory drift';; *) die 'cron mutation kind invalid';; esac
    [ "$(cron_mutation_mount_state "$cron_path")" = absent ] || die 'cron mutation surface already mounted'
    cron_state=$(jq -cn --argjson old "$cron_state" --arg kind "$cron_kind" --arg path "$cron_path" --arg identity "$(cron_mutation_identity "$cron_path")" --arg digest "$(cron_mutation_digest "$cron_kind" "$cron_path")" '$old + [{kind:$kind,path:$path,identity:$identity,contentSha256:$digest,originalMountState:"absent",quiescedMountState:"ro-bind"}]') || die 'cron mutation state serialization failed'
  done <"$cron_state_paths"
  rm -f "$cron_state_paths"; printf '%s\n' "$cron_state"
}

assert_cron_mutation_item() {
  cron_item=$1; cron_kind=$(printf '%s\n' "$cron_item" | jq -er '.kind'); cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); cron_identity=$(printf '%s\n' "$cron_item" | jq -er '.identity'); cron_digest=$(printf '%s\n' "$cron_item" | jq -er '.contentSha256') || die 'cron mutation receipt invalid'
  case "$cron_kind" in file) [ -f "$cron_path" ] && [ ! -L "$cron_path" ] && [ "$(sha "$cron_path")" = "$cron_digest" ] || die 'cron mutation file drift';; directory) [ -d "$cron_path" ] && [ ! -L "$cron_path" ] && [ "$cron_digest" = directory ] || die 'cron mutation directory drift';; *) die 'cron mutation receipt invalid';; esac
  [ "$(cron_mutation_identity "$cron_path")" = "$cron_identity" ] || die 'cron mutation identity drift'
}

assert_cron_mutation_receipt() {
  cron_expected=$1; printf '%s\n' "$cron_expected" | jq -e 'type == "array" and length >= 3 and length <= 9 and all(.[]; keys == ["contentSha256","identity","kind","originalMountState","path","quiescedMountState"] and (.kind == "file" or .kind == "directory") and (.path | test("^/[-A-Za-z0-9._/]+$")) and (.identity | test("^[0-9]+:[0-9]+:[0-9a-f]+:[0-9]+:[0-9]+:[0-7]+$")) and .originalMountState == "absent" and .quiescedMountState == "ro-bind") and ([.[].path] | length == (unique | length))' >/dev/null || die 'cron mutation receipt invalid'
  cron_receipt_paths=$(temp_path); cron_live_paths=$(temp_path); printf '%s\n' "$cron_expected" | jq -r '.[] | [.kind,.path] | @tsv' >"$cron_receipt_paths" || die 'cron mutation receipt invalid'; cron_mutation_surface_paths >"$cron_live_paths" || die 'cron mutation surface discovery failed'; cmp -s "$cron_receipt_paths" "$cron_live_paths" || { rm -f "$cron_receipt_paths" "$cron_live_paths"; die 'cron mutation surface drift'; }; rm -f "$cron_receipt_paths" "$cron_live_paths"
}

assert_cron_mutations_quiesced() {
  cron_expected=$1; assert_cron_mutation_receipt "$cron_expected"
  printf '%s\n' "$cron_expected" | jq -c '.[]' | while IFS= read -r cron_item; do assert_cron_mutation_item "$cron_item"; cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); [ "$(cron_mutation_mount_state "$cron_path")" = ro ] || die 'cron mutation quiescence drift'; done
}

quiesce_cron_mutations() {
  cron_expected=$1; assert_cron_mutation_receipt "$cron_expected"
  printf '%s\n' "$cron_expected" | jq -c '.[]' | while IFS= read -r cron_item; do assert_cron_mutation_item "$cron_item"; cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); [ "$(cron_mutation_mount_state "$cron_path")" = absent ] || die 'cron mutation mount drift'; /usr/bin/mount --bind "$cron_path" "$cron_path" || die 'cron mutation bind failed'; /usr/bin/mount -o remount,bind,ro "$cron_path" "$cron_path" || die 'cron mutation read-only remount failed'; done
  assert_cron_mutations_quiesced "$cron_expected"
}

reconcile_interrupted_cron_quiescence() {
  cron_expected=$1; assert_cron_mutation_receipt "$cron_expected"
  printf '%s\n' "$cron_expected" | jq -c 'reverse[]' | while IFS= read -r cron_item; do assert_cron_mutation_item "$cron_item"; cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); case "$(cron_mutation_mount_state "$cron_path")" in absent) :;; rw|ro) cron_unmount_mutation_surface "$cron_path"; [ "$(cron_mutation_mount_state "$cron_path")" = absent ] || die 'cron mutation rollback mount drift'; assert_cron_mutation_item "$cron_item";; *) die 'cron mutation rollback mount drift';; esac; done
}

assert_scheduled_mutations_quiesced() { assert_at_submissions_quiesced "$1"; assert_cron_mutations_quiesced "$2"; }

reconcile_interrupted_at_quiescence() {
  at_pre="$RECEIPT_DIR/pre-destructive.json"
  at_actions="$RECEIPT_DIR/pre-destructive.actions"
  [ -e "$at_pre" ] || return 0
  safe_file "$at_pre" || die 'unsafe pre-destructive receipt'
  at_expected=$(jq -ce '.atSubmissionRollback | select((.scheduler == "absent" and length == 1) or (.path == $path and .originalMountState == "absent" and .quiescedMountState == "ro-bind" and (.identity | test("^[0-9]+:[0-9]+:[0-9]+:[0-9]+$")) and (.sequenceIdentity | test("^[0-9]+:[0-9]+:[0-9]+:[0-9]+$"))))' --arg path "$AT_JOB_DIR" "$at_pre") ||
    die 'at rollback receipt invalid'
  cron_expected=$(jq -ce '.cronMutationRollback // []' "$at_pre") || die 'cron rollback receipt invalid'
  if [ -e "$at_actions" ]; then
    safe_file "$at_actions" || return 0
    if grep -Fqx quiesce_cron_mutations "$at_actions"; then reconcile_interrupted_cron_quiescence "$cron_expected"; else printf '%s\n' "$cron_expected" | jq -c '.[]' | while IFS= read -r cron_item; do cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); [ "$(cron_mutation_mount_state "$cron_path")" = absent ] || return 1; assert_cron_mutation_item "$cron_item"; done || return 0; fi
    grep -Fqx quiesce_at_submissions "$at_actions" || return 0
    case "$(at_submission_mount_state)" in
      absent) assert_at_submission_identity "$at_expected" ;;
      rw|ro)
        if printf '%s\n' "$at_expected" | jq -e '.scheduler == "absent"' >/dev/null; then
          die 'at scheduler absence drift'
        fi
        assert_at_submission_identity "$at_expected"
        at_unmount_submission_spool
        [ "$(at_submission_mount_state)" = absent ] ||
          die 'at rollback unmount drift'
        assert_at_submission_identity "$at_expected"
        ;;
      *) die 'at rollback mount state drift' ;;
    esac
    rm -f "$at_actions" || die 'at rollback action cleanup failed'
    fsync_dir "$RECEIPT_DIR"
  else
    [ "$(printf '%s\n' "$cron_expected" | jq 'length')" -eq 0 ] || { printf '%s\n' "$cron_expected" | jq -c '.[]' | while IFS= read -r cron_item; do cron_path=$(printf '%s\n' "$cron_item" | jq -er '.path'); [ "$(cron_mutation_mount_state "$cron_path")" = absent ] || return 1; assert_cron_mutation_item "$cron_item"; done; }
    [ "$(at_submission_mount_state)" = absent ] || return 0
    assert_at_submission_identity "$at_expected"
  fi
  rm -f "$at_pre" || die 'at rollback receipt cleanup failed'
  fsync_dir "$RECEIPT_DIR"
}
