#!/bin/sh
# Crash-safe, source-bound publication for the read-only recovery receipt pair.

recovery_fixed_receipt_dir() {
  printf '%s/%s\n' "$(recovery_receipt_base)" "$RECOVERY_SOURCE_SHA"
}

recovery_receipt_base() {
  if [ "$(id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then
    printf '%s\n' "$RETIRE_OLLAMA_RECOVERY_TEST_ROOT"
  else
    printf '%s\n' "$RECOVERY_RECEIPT_ROOT"
  fi
}

recovery_json_digest() {
  candidate=$1; recovery_safe_receipt_file "$candidate" || return 1; canonical=$(temp_path)
  /usr/bin/jq -S -c . "$candidate" >"$canonical" || { /bin/rm -f -- "$canonical" || return 1; return 1; }
  /usr/bin/cmp -s "$candidate" "$canonical" || { /bin/rm -f -- "$canonical" || return 1; return 1; }
  digest=$(sha "$canonical") || { /bin/rm -f -- "$canonical" || return 1; return 1; }
  /bin/rm -f -- "$canonical" || return 1
  printf '%s\n' "$digest"
}

recovery_remove_durable() {
  target=$1; directory=$2
  fsync_dir "$directory" || return 1
  /bin/rm -f -- "$target" || return 1
  fsync_dir "$directory" || return 1
}

recovery_drift_snapshot() {
  source=$1; target=$2
  /usr/bin/jq -S '
    if (.processes | type) == "object" then .processes = (.processes | del(.scannerAncestors)) else . end |
    .surfaces = ((.surfaces // []) | map(select(.class != "running-processes"))) |
    .dependencies = ((.dependencies // []) | map(select((.["key-name"] // "") | startswith("running-processes:") | not))) |
    .consumerCounts = ((.consumerCounts // []) | map(select(.surface != "running-processes"))) |
    .consumerEvidence = ((.consumerEvidence // []) | map(select(.surface != "running-processes")))
  ' "$source" >"$target"
}

recovery_bound_sha() {
  source=$1; snapshot=$(temp_path) || return 1
  /usr/bin/perl -MTime::HiRes=stat,lstat -MFcntl=O_RDONLY,O_NOFOLLOW,O_WRONLY,O_TRUNC -e 'my($s,$d)=@ARGV;sub f{exit 2};sub shape{my($x)=@_;return""unless@$x&&($x->[2]&0170000)==0100000&&$x->[3]==1;return join(":",@$x[0,1,2,3,4,5,7])}sub stamp{my($x)=@_;return join(":",@$x[9,10])}my@b=lstat($s);my$bshape=shape(\@b);f()unless$bshape;sysopen(my$i,$s,O_RDONLY|O_NOFOLLOW)or f();my@o=stat($i);f()unless shape(\@o)eq$bshape;my$x="";while(1){my$n=sysread($i,my$c,65536);defined$n or f();last unless$n;$x.=$c}my@a=stat($i);f()unless shape(\@o)eq shape(\@a)&&stamp(\@o)eq stamp(\@a);my@p=lstat($s);f()unless shape(\@p)eq shape(\@o)&&stamp(\@p)eq stamp(\@a);close($i)or f();sysopen(my$o,$d,O_WRONLY|O_TRUNC|O_NOFOLLOW)or f();my$p=0;while($p<length$x){my$n=syswrite($o,$x,length$x-$p, $p);defined$n&&$n>0 or f();$p+=$n}close($o)or f()' "$source" "$snapshot" || { /bin/rm -f -- "$snapshot" || return 1; return 1; }
  value=$(sha "$snapshot") || { /bin/rm -f -- "$snapshot" || return 1; return 1; }
  /bin/rm -f -- "$snapshot" || return 1
  printf '%s\n' "$value"
}

recovery_source_digests() {
  actual_script=$(recovery_bound_sha "$SCRIPT_DIR/retire-ollama.sh") || return 1
  actual_helper=$(recovery_bound_sha "$RECOVERY_HELPER") || return 1
  actual_receipts=$(recovery_bound_sha "$RECOVERY_RECEIPTS_HELPER") || return 1
  actual_consumers=$(recovery_bound_sha "$RECOVERY_CONSUMERS_HELPER") || return 1
  actual_consumer_mounts=$(recovery_bound_sha "$RECOVERY_CONSUMER_MOUNTS_HELPER") || return 1
  actual_image_filesystem=$(recovery_bound_sha "$RECOVERY_IMAGE_FILESYSTEM_HELPER") || return 1
  [ -z "${running_projector_expected_sha:-}" ] || [ "$actual_image_filesystem" = "$running_projector_expected_sha" ] || return 1
  actual_running_container=$(recovery_bound_sha "$RECOVERY_RUNNING_CONTAINER_HELPER") || return 1
  actual_running_container_validation=$(recovery_bound_sha "$RECOVERY_RUNNING_CONTAINER_VALIDATION_HELPER") || return 1
  actual_running_archive=$(recovery_bound_sha "$RECOVERY_RUNNING_ARCHIVE_HELPER") || return 1
  actual_consumer_closure=$(recovery_bound_sha "$RECOVERY_CONSUMER_CLOSURE_HELPER") || return 1
  actual_process_files=$(recovery_bound_sha "$RECOVERY_PROCESS_FILES_HELPER") || return 1
  actual_cron_inventory=$(recovery_bound_sha "$SCRIPT_DIR/retire-ollama-cron-inventory.sh") || return 1
  actual_at_quiescence=$(recovery_bound_sha "$SCRIPT_DIR/retire-ollama-at-quiescence.sh") || return 1
  actual_projector_auth=$(recovery_bound_sha "$RECOVERY_PROJECTOR_AUTH_HELPER") || return 1
  [ -z "${RECOVERY_HELPER_LOADED_SHA:-}" ] || [ "$actual_helper" = "$RECOVERY_HELPER_LOADED_SHA" ] || return 1
  [ -z "${PROJECTOR_AUTH_HELPER_SHA:-}" ] || [ "$actual_projector_auth" = "$PROJECTOR_AUTH_HELPER_SHA" ] || return 1
  [ -z "${RECOVERY_RECEIPTS_LOADED_SHA:-}" ] || [ "$actual_receipts" = "$RECOVERY_RECEIPTS_LOADED_SHA" ] || return 1; [ -z "${RECOVERY_PROCESS_FILES_LOADED_SHA:-}" ] || [ "$actual_process_files" = "$RECOVERY_PROCESS_FILES_LOADED_SHA" ] || return 1; [ -z "${CONSUMER_SCANNERS_LOADED_SHA:-}" ] || [ "$actual_consumers" = "$CONSUMER_SCANNERS_LOADED_SHA" ] || return 1; [ -z "${CONSUMER_CLOSURE_LOADED_SHA:-}" ] || [ "$actual_consumer_closure" = "$CONSUMER_CLOSURE_LOADED_SHA" ] || return 1; [ -z "${CONSUMER_ARCHIVE_LOADED_SHA:-}" ] || [ "$actual_running_archive" = "$CONSUMER_ARCHIVE_LOADED_SHA" ] || return 1; [ -z "${CONSUMER_RUNNING_LOADED_SHA:-}" ] || [ "$actual_running_container" = "$CONSUMER_RUNNING_LOADED_SHA" ] || return 1; [ -z "${RUNNING_CONTAINER_VALIDATION_HELPER_SHA:-}" ] || [ "$actual_running_container_validation" = "$RUNNING_CONTAINER_VALIDATION_HELPER_SHA" ] || return 1; [ -z "${CONSUMER_MOUNTS_LOADED_SHA:-}" ] || [ "$actual_consumer_mounts" = "$CONSUMER_MOUNTS_LOADED_SHA" ] || return 1; [ -z "${CRON_INVENTORY_HELPER_SHA:-}" ] || [ "$actual_cron_inventory" = "$CRON_INVENTORY_HELPER_SHA" ] || return 1; [ -z "${AT_QUIESCENCE_HELPER_SHA:-}" ] || [ "$actual_at_quiescence" = "$AT_QUIESCENCE_HELPER_SHA" ] || return 1
  test_mode=0
  if [ "$(id -u)" -ne 0 ] && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then
    test_mode=1
    RECOVERY_SCRIPT_SHA=${RECOVERY_SCRIPT_SHA:-$actual_script}; RECOVERY_HELPER_SHA=${RECOVERY_HELPER_SHA:-$actual_helper}; RECOVERY_RECEIPTS_SHA=${RECOVERY_RECEIPTS_SHA:-$actual_receipts}; RECOVERY_CONSUMERS_SHA=${RECOVERY_CONSUMERS_SHA:-$actual_consumers}; RECOVERY_RUNNING_CONTAINER_SHA=${RECOVERY_RUNNING_CONTAINER_SHA:-$actual_running_container}; RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA=${RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA:-$actual_running_container_validation}; RECOVERY_RUNNING_ARCHIVE_SHA=${RECOVERY_RUNNING_ARCHIVE_SHA:-$actual_running_archive}; RECOVERY_CONSUMER_CLOSURE_SHA=${RECOVERY_CONSUMER_CLOSURE_SHA:-$actual_consumer_closure}; RECOVERY_PROCESS_FILES_SHA=${RECOVERY_PROCESS_FILES_SHA:-$actual_process_files}; RECOVERY_CRON_INVENTORY_SHA=${RECOVERY_CRON_INVENTORY_SHA:-$actual_cron_inventory}; RECOVERY_AT_QUIESCENCE_SHA=${RECOVERY_AT_QUIESCENCE_SHA:-$actual_at_quiescence}; RECOVERY_PROJECTOR_AUTH_SHA=${RECOVERY_PROJECTOR_AUTH_SHA:-$actual_projector_auth}
    RECOVERY_CONSUMER_MOUNTS_SHA=${RECOVERY_CONSUMER_MOUNTS_SHA:-$actual_consumer_mounts}; RECOVERY_IMAGE_FILESYSTEM_SHA=${RECOVERY_IMAGE_FILESYSTEM_SHA:-$actual_image_filesystem}
  else
    RECOVERY_SCRIPT_SHA=$actual_script; RECOVERY_HELPER_SHA=$actual_helper; RECOVERY_RECEIPTS_SHA=$actual_receipts; RECOVERY_CONSUMERS_SHA=$actual_consumers; RECOVERY_RUNNING_CONTAINER_SHA=$actual_running_container; RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA=$actual_running_container_validation; RECOVERY_RUNNING_ARCHIVE_SHA=$actual_running_archive; RECOVERY_CONSUMER_CLOSURE_SHA=$actual_consumer_closure; RECOVERY_PROCESS_FILES_SHA=$actual_process_files; RECOVERY_CRON_INVENTORY_SHA=$actual_cron_inventory; RECOVERY_AT_QUIESCENCE_SHA=$actual_at_quiescence; RECOVERY_PROJECTOR_AUTH_SHA=$actual_projector_auth
    RECOVERY_CONSUMER_MOUNTS_SHA=$actual_consumer_mounts
    RECOVERY_IMAGE_FILESYSTEM_SHA=$actual_image_filesystem
  fi
  actual_temp_root=$(recovery_bound_sha "$RECOVERY_TEMP_ROOT_HELPER") || return 1; [ -z "${TEMP_ROOT_HELPER_SHA:-}" ] || [ "$actual_temp_root" = "$TEMP_ROOT_HELPER_SHA" ] || return 1
  if [ "$test_mode" -eq 1 ]; then
    RECOVERY_TEMP_ROOT_SHA=${RECOVERY_TEMP_ROOT_SHA:-$actual_temp_root}
  else
    RECOVERY_TEMP_ROOT_SHA=$actual_temp_root
  fi
}

recovery_validate_json() {
  candidate=$1; recovery_safe_receipt_file "$candidate" || return 1
  recovery_source_digests || return 1
  /usr/bin/jq -e -s --arg source "$RECOVERY_SOURCE_SHA" --arg script "$RECOVERY_SCRIPT_SHA" --arg helper "$RECOVERY_HELPER_SHA" --arg receipts "$RECOVERY_RECEIPTS_SHA" --arg consumers "$RECOVERY_CONSUMERS_SHA" --arg consumer_mounts "$RECOVERY_CONSUMER_MOUNTS_SHA" --arg image_filesystem "$RECOVERY_IMAGE_FILESYSTEM_SHA" --arg temp_root "$RECOVERY_TEMP_ROOT_SHA" --arg running_container "$RECOVERY_RUNNING_CONTAINER_SHA" --arg running_container_validation "$RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA" --arg running_archive "$RECOVERY_RUNNING_ARCHIVE_SHA" --arg consumer_closure "$RECOVERY_CONSUMER_CLOSURE_SHA" --arg process_files "$RECOVERY_PROCESS_FILES_SHA" --arg cron_inventory "$RECOVERY_CRON_INVENTORY_SHA" --arg at_quiescence "$RECOVERY_AT_QUIESCENCE_SHA" --arg projector_auth "$RECOVERY_PROJECTOR_AUTH_SHA" '
    length == 1 and (.[0] |
      type == "object" and (keys_unsorted | sort) == ["destructiveAuthority","inventoryBinding","mode","scan","schemaVersion","sourceBinding"] and .schemaVersion == 3 and .mode == "recovery-scan" and
      .destructiveAuthority == false and
      (.inventoryBinding | type == "object" and (keys_unsorted | sort) == ["requiresSeparateReview"] and .requiresSeparateReview == true) and
      (.sourceBinding | type == "object" and (keys_unsorted | sort) == ["atQuiescenceSha256","consumerClosureSha256","consumerMountsSha256","consumersSha256","cronInventorySha256","helperSha256","imageFilesystemSha256","processFilesSha256","projectorAuthSha256","receiptsSha256","runningArchiveSha256","runningContainerSha256","runningContainerValidationSha256","scriptSha256","sourceSha","tempRootSha256"] and (.sourceSha | type == "string" and test("^[0-9a-f]{40}$") and . == $source) and
        .scriptSha256 == $script and .helperSha256 == $helper and .receiptsSha256 == $receipts and .consumersSha256 == $consumers and .consumerMountsSha256 == $consumer_mounts and .imageFilesystemSha256 == $image_filesystem and .tempRootSha256 == $temp_root and .runningContainerSha256 == $running_container and .runningContainerValidationSha256 == $running_container_validation and .runningArchiveSha256 == $running_archive and .consumerClosureSha256 == $consumer_closure and .processFilesSha256 == $process_files and .cronInventorySha256 == $cron_inventory and .atQuiescenceSha256 == $at_quiescence and .projectorAuthSha256 == $projector_auth and
        ([.scriptSha256,.helperSha256,.receiptsSha256,.consumersSha256,.consumerMountsSha256,.imageFilesystemSha256,.tempRootSha256,.runningContainerSha256,.runningContainerValidationSha256,.runningArchiveSha256,.consumerClosureSha256,.processFilesSha256,.cronInventorySha256,.atQuiescenceSha256,.projectorAuthSha256] | all(.[]; type == "string" and test("^[0-9a-f]{64}$")))) and
      (.scan | type == "object")
    )
  ' "$candidate" >/dev/null
}

recovery_read_digest() {
  candidate=$1; recovery_safe_receipt_file "$candidate" || return 1
  value=$(cat "$candidate") || return 1
  case "$value" in ''|*[!0-9a-f]*) return 1;; esac
  [ "${#value}" -eq 64 ] || return 1
  printf '%s\n' "$value"
}

recovery_pair_digest() {
  pair_json=$1; pair_digest=$2
  recovery_safe_receipt_file "$pair_json" || return 1; recovery_safe_receipt_file "$pair_digest" || return 1
  recovery_validate_json "$pair_json" || return 1
  pair_digest_value=$(recovery_read_digest "$pair_digest") || return 1
  pair_json_value=$(recovery_json_digest "$pair_json") || return 1
  [ -n "$pair_digest_value" ] && [ -n "$pair_json_value" ] && [ "$pair_digest_value" = "$pair_json_value" ]
}

recovery_publish_link() {
  pending=$1; target=$2
  recovery_safe_receipt_file "$pending" || return 1
  [ ! -e "$target" ] && [ ! -L "$target" ] || return 1
  ln -- "$pending" "$target" || return 1
  recovery_safe_receipt_ancestry "${target%/*}" || return 1
  recovery_safe_receipt_file "$target" || return 1
  fsync_file "$target" || return 1
  fsync_dir "${target%/*}" || return 1
  /bin/rm -f -- "$pending" || return 1
  fsync_dir "${target%/*}" || return 1
}

recovery_reconcile_duplicate_link() {
  pending=$1; target=$2
  recovery_safe_receipt_file "$pending" || return 1
  recovery_safe_receipt_file "$target" || return 1
  pending_identity=$(stat -c '%d:%i' "$pending") || return 1; target_identity=$(stat -c '%d:%i' "$target") || return 1
  [ -n "$pending_identity" ] && [ -n "$target_identity" ] && [ "$pending_identity" = "$target_identity" ] || return 1
  pending_digest=$(recovery_json_digest "$pending") || return 1; target_digest=$(recovery_json_digest "$target") || return 1
  [ -n "$pending_digest" ] && [ -n "$target_digest" ] && [ "$pending_digest" = "$target_digest" ] || return 1
  recovery_remove_durable "$pending" "${target%/*}"
}

recovery_reconcile_digest_link() {
  pending=$1; target=$2
  recovery_safe_receipt_file "$pending" || return 1
  recovery_safe_receipt_file "$target" || return 1
  pending_identity=$(stat -c '%d:%i' "$pending") || return 1; target_identity=$(stat -c '%d:%i' "$target") || return 1
  [ -n "$pending_identity" ] && [ -n "$target_identity" ] && [ "$pending_identity" = "$target_identity" ] || return 1
  pending_digest=$(recovery_read_digest "$pending") || return 1; target_digest=$(recovery_read_digest "$target") || return 1
  [ -n "$pending_digest" ] && [ -n "$target_digest" ] && [ "$pending_digest" = "$target_digest" ] || return 1
  recovery_remove_durable "$pending" "${target%/*}"
}

recovery_safe_receipt_file() {
  file=$1; [ -f "$file" ] && [ ! -L "$file" ] || return 1; [ "$(stat -c '%a' "$file")" = 600 ] || return 1
  if [ "$(id -u)" -eq 0 ]; then [ "$(stat -c '%u:%g' "$file")" = 0:0 ] || return 1; fi
}

recovery_safe_receipt_ancestry() {
  generation=$1; root_directory=${generation%/*}; root_parent=${root_directory%/*}
  [ "$root_directory" = "$(recovery_receipt_base)" ] || return 1
  [ -d "$root_parent" ] && [ ! -L "$root_parent" ] && [ "$(readlink -f -- "$root_parent")" = "$root_parent" ] || return 1
  [ -d "$root_directory" ] && [ ! -L "$root_directory" ] && [ "$(readlink -f -- "$root_directory")" = "$root_directory" ] || return 1
  recovery_safe_receipt_parent "$root_parent" && recovery_safe_dir "$root_directory" && recovery_safe_dir "$generation"
}

recovery_receipt_temp_path() {
  directory=$1; recovery_safe_receipt_ancestry "$directory" || return 1
  # Post-creation failures retain this residue for validated, durable reconciliation on the next run.
  temporary=$(mktemp "$directory/.recovery-publish.XXXXXX") || return 1
  chmod 0600 "$temporary" || return 1
  recovery_safe_receipt_file "$temporary" || return 1
  printf '%s\n' "$temporary"
}

recovery_safe_dir() {
  directory=$1; [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  [ "$(stat -c '%a' "$directory")" = 700 ] || return 1
  if [ "$(id -u)" -eq 0 ]; then [ "$(stat -c '%u:%g' "$directory")" = 0:0 ] || return 1; fi
}

recovery_safe_receipt_parent() {
  directory=$1; [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  [ "$(readlink -f -- "$directory")" = "$directory" ] || return 1
  mode=$(stat -c '%a' "$directory") || return 1
  case "$mode" in ''|*[!0-7]*) return 1;; esac
  [ $((0$mode & 022)) -eq 0 ] || return 1
  if [ "$(id -u)" -eq 0 ]; then [ "$(stat -c '%u:%g' "$directory")" = 0:0 ] || return 1; fi
}

recovery_prepare_one_dir() {
  directory=$1; parent=$2
  if [ -e "$directory" ] || [ -L "$directory" ]; then recovery_safe_dir "$directory" || die 'unsafe recovery receipt directory'; return; fi
  [ -d "$parent" ] && [ ! -L "$parent" ] || die 'unsafe recovery receipt parent'
  mkdir "$directory" || die 'recovery receipt directory failed'
  chmod 0700 "$directory" || die 'recovery receipt directory mode failed'
  fsync_dir "$parent" || die 'recovery receipt parent sync failed'
  recovery_safe_dir "$directory" || die 'unsafe recovery receipt directory'
}

recovery_prepare_dir() {
  target=$1; root_directory=${target%/*}; root_parent=${root_directory%/*}; expected_root=$(recovery_receipt_base)
  [ "$root_directory" = "$expected_root" ] || die 'recovery receipt root mismatch'
  [ -n "$root_directory" ] && [ "$root_directory" != "$target" ] || die 'invalid recovery receipt directory'
  [ -d "$root_parent" ] && [ ! -L "$root_parent" ] && [ "$(readlink -f -- "$root_parent")" = "$root_parent" ] || die 'unsafe recovery receipt parent'
  recovery_safe_receipt_parent "$root_parent" || die 'unsafe recovery receipt parent'
  recovery_prepare_one_dir "$root_directory" "$root_parent"; recovery_prepare_one_dir "$target" "$root_directory"; recovery_safe_receipt_ancestry "$target" || die 'recovery receipt ancestry changed'
}

recovery_make_digest_file() {
  source=$1; target=$2; [ ! -e "$target" ] && [ ! -L "$target" ] || return 1
  value=$(recovery_json_digest "$source") || return 1
  temporary=$(recovery_receipt_temp_path "${target%/*}") || return 1
  printf '%s\n' "$value" >"$temporary" || return 1
  fsync_file "$temporary" || return 1
  recovery_publish_link "$temporary" "$target" || return 1
}

recovery_no_pending() {
  directory=$1; for pending in "$directory"/*.pending; do [ -e "$pending" ] || [ -L "$pending" ] || continue; return 1; done; return 0
}

recovery_reconcile_publish_temporaries() {
  directory=$1; json="$directory/recovery-scan.json"; digest="$json.sha256"
  for temporary in "$directory"/.recovery-publish.*; do
    [ -e "$temporary" ] || [ -L "$temporary" ] || continue
    recovery_safe_receipt_file "$temporary" || return 1
    temporary_identity=$(stat -c '%d:%i' "$temporary") || return 1
    [ -n "$temporary_identity" ] || return 1
    if [ -e "$json" ]; then json_identity=$(stat -c '%d:%i' "$json") || return 1; [ -n "$json_identity" ] || return 1; if [ "$temporary_identity" = "$json_identity" ]; then recovery_reconcile_duplicate_link "$temporary" "$json" || return 1; continue; fi; fi
    if [ -e "$digest" ]; then digest_identity=$(stat -c '%d:%i' "$digest") || return 1; [ -n "$digest_identity" ] || return 1; if [ "$temporary_identity" = "$digest_identity" ]; then recovery_reconcile_digest_link "$temporary" "$digest" || return 1; continue; fi; fi
    recovery_remove_durable "$temporary" "$directory" || return 1
  done
}

recovery_reconcile_pair() {
  directory=$1; json="$directory/recovery-scan.json"; digest="$json.sha256"; json_pending="$json.pending"; digest_pending="$digest.pending"
  recovery_reconcile_publish_temporaries "$directory" || review_required 'recovery publication temporary residue'
  json_exists=0; digest_exists=0; json_pending_exists=0; digest_pending_exists=0
  [ -e "$json" ] || [ -L "$json" ] && json_exists=1; [ -e "$digest" ] || [ -L "$digest" ] && digest_exists=1
  [ -e "$json_pending" ] || [ -L "$json_pending" ] && json_pending_exists=1; [ -e "$digest_pending" ] || [ -L "$digest_pending" ] && digest_pending_exists=1
  if [ "$json_exists" -eq 1 ]; then
    [ -f "$json" ] && [ ! -L "$json" ] || review_required 'recovery receipt JSON unsafe'
    recovery_validate_json "$json" || review_required 'recovery receipt JSON unsafe'
  fi
  if [ "$digest_exists" -eq 1 ]; then
    [ -f "$digest" ] && [ ! -L "$digest" ] || review_required 'recovery receipt digest unsafe'
    recovery_read_digest "$digest" >/dev/null || review_required 'recovery receipt digest unsafe'
  fi
  if [ "$json_exists" -eq 1 ] && [ "$digest_exists" -eq 1 ]; then
    recovery_pair_digest "$json" "$digest" || review_required 'recovery receipt pair drift'
    if [ "$json_pending_exists" -eq 1 ]; then if [ "$digest_pending_exists" -eq 1 ]; then recovery_pair_digest "$json_pending" "$digest_pending" || review_required 'recovery pending JSON pair drift'; fi; recovery_reconcile_duplicate_link "$json_pending" "$json" || review_required 'recovery pending JSON residue'; fi
    if [ "$digest_pending_exists" -eq 1 ]; then pending_digest=$(recovery_read_digest "$digest_pending") || review_required 'recovery pending digest drift'; digest_value=$(recovery_read_digest "$digest") || review_required 'recovery pending digest drift'; [ -n "$pending_digest" ] && [ -n "$digest_value" ] && [ "$pending_digest" = "$digest_value" ] || review_required 'recovery pending digest drift'; recovery_remove_durable "$digest_pending" "$directory" || review_required 'recovery pending digest cleanup failed'; fi
    recovery_no_pending "$directory" || review_required 'recovery receipt pending residue'; return 0
  fi
  if [ "$json_exists" -eq 1 ]; then
    if [ "$digest_pending_exists" -eq 1 ]; then pending_digest=$(recovery_read_digest "$digest_pending") || review_required 'recovery digest pending drift'; json_digest=$(recovery_json_digest "$json") || review_required 'recovery digest pending drift'; [ -n "$pending_digest" ] && [ -n "$json_digest" ] && [ "$pending_digest" = "$json_digest" ] || review_required 'recovery digest pending drift'; recovery_publish_link "$digest_pending" "$digest" || review_required 'recovery digest publication race'; else recovery_make_digest_file "$json" "$digest" || review_required 'recovery digest publication failed'; fi
    if [ "$json_pending_exists" -eq 1 ]; then recovery_reconcile_duplicate_link "$json_pending" "$json" || review_required 'recovery pending JSON residue'; fi
    recovery_pair_digest "$json" "$digest" || review_required 'recovery receipt pair drift'; recovery_no_pending "$directory" || review_required 'recovery receipt pending residue'; return 0
  fi
  if [ "$digest_exists" -eq 1 ]; then
    [ "$json_pending_exists" -eq 1 ] || review_required 'recovery receipt JSON missing'
    recovery_validate_json "$json_pending" || review_required 'recovery JSON pending unsafe'; pending_json_digest=$(recovery_json_digest "$json_pending") || review_required 'recovery JSON pending drift'; digest_value=$(recovery_read_digest "$digest") || review_required 'recovery JSON pending drift'; [ -n "$pending_json_digest" ] && [ -n "$digest_value" ] && [ "$pending_json_digest" = "$digest_value" ] || review_required 'recovery JSON pending drift'
    recovery_publish_link "$json_pending" "$json" || review_required 'recovery JSON publication race'; recovery_pair_digest "$json" "$digest" || review_required 'recovery receipt pair drift'; recovery_no_pending "$directory" || review_required 'recovery receipt pending residue'; return 0
  fi
  if [ "$json_pending_exists" -eq 0 ]; then [ "$digest_pending_exists" -eq 0 ] && return 1; review_required 'recovery receipt JSON pending missing'; fi
  recovery_validate_json "$json_pending" || review_required 'recovery JSON pending unsafe'
  if [ "$digest_pending_exists" -eq 0 ]; then recovery_make_digest_file "$json_pending" "$digest_pending" || review_required 'recovery digest pending failed'; fi
  recovery_pair_digest "$json_pending" "$digest_pending" || review_required 'recovery pending receipt pair drift'
  recovery_publish_link "$json_pending" "$json" || review_required 'recovery JSON publication race'; recovery_publish_link "$digest_pending" "$digest" || review_required 'recovery digest publication race'
  recovery_pair_digest "$json" "$digest" || review_required 'recovery receipt pair drift'; recovery_no_pending "$directory" || review_required 'recovery receipt pending residue'; return 0
}

recovery_write_receipt() {
  snapshot=$1; directory=$(recovery_fixed_receipt_dir); recovery_prepare_dir "$directory"
  if recovery_reconcile_pair "$directory"; then
    current=$(temp_path); recovery_drift_snapshot "$snapshot" "$current" || die 'recovery snapshot invalid'
    stored_source=$(temp_path); /usr/bin/jq -S -c .scan "$directory/recovery-scan.json" >"$stored_source" || die 'recovery stored scan invalid'
    stored=$(temp_path); recovery_drift_snapshot "$stored_source" "$stored" || die 'recovery stored scan invalid'
    /usr/bin/cmp -s "$current" "$stored" || { /bin/rm -f -- "$current" "$stored_source" "$stored" || die 'recovery temporary cleanup failed'; review_required 'recovery receipt snapshot drift'; }
    /bin/rm -f -- "$current" "$stored_source" "$stored" || die 'recovery temporary cleanup failed'
    cat "$directory/recovery-scan.json.sha256" || die 'recovery receipt digest read failed'; return 0
  fi
  recovery_source_digests || die 'recovery source digest failed'
  json="$directory/recovery-scan.json"; digest="$json.sha256"; json_pending="$json.pending"; digest_pending="$digest.pending"
  [ ! -e "$json" ] && [ ! -L "$json" ] && [ ! -e "$digest" ] && [ ! -L "$digest" ] && [ ! -e "$json_pending" ] && [ ! -L "$json_pending" ] && [ ! -e "$digest_pending" ] && [ ! -L "$digest_pending" ] || review_required 'recovery receipt publication race'
  pending=$(recovery_receipt_temp_path "$directory") || review_required 'recovery receipt temporary failed'
  /usr/bin/jq -S -c -n --slurpfile scan "$snapshot" --arg source "$RECOVERY_SOURCE_SHA" --arg script "$RECOVERY_SCRIPT_SHA" --arg helper "$RECOVERY_HELPER_SHA" --arg receipts "$RECOVERY_RECEIPTS_SHA" --arg consumers "$RECOVERY_CONSUMERS_SHA" --arg consumer_mounts "$RECOVERY_CONSUMER_MOUNTS_SHA" --arg image_filesystem "$RECOVERY_IMAGE_FILESYSTEM_SHA" --arg temp_root "$RECOVERY_TEMP_ROOT_SHA" --arg running_container "$RECOVERY_RUNNING_CONTAINER_SHA" --arg running_container_validation "$RECOVERY_RUNNING_CONTAINER_VALIDATION_SHA" --arg running_archive "$RECOVERY_RUNNING_ARCHIVE_SHA" --arg consumer_closure "$RECOVERY_CONSUMER_CLOSURE_SHA" --arg process_files "$RECOVERY_PROCESS_FILES_SHA" --arg cron_inventory "$RECOVERY_CRON_INVENTORY_SHA" --arg at_quiescence "$RECOVERY_AT_QUIESCENCE_SHA" --arg projector_auth "$RECOVERY_PROJECTOR_AUTH_SHA" '{schemaVersion:3,mode:"recovery-scan",destructiveAuthority:false,inventoryBinding:{requiresSeparateReview:true},sourceBinding:{sourceSha:$source,scriptSha256:$script,helperSha256:$helper,receiptsSha256:$receipts,consumersSha256:$consumers,consumerMountsSha256:$consumer_mounts,imageFilesystemSha256:$image_filesystem,tempRootSha256:$temp_root,runningContainerSha256:$running_container,runningContainerValidationSha256:$running_container_validation,runningArchiveSha256:$running_archive,consumerClosureSha256:$consumer_closure,processFilesSha256:$process_files,cronInventorySha256:$cron_inventory,atQuiescenceSha256:$at_quiescence,projectorAuthSha256:$projector_auth},scan:$scan[0]}' >"$pending" || die 'recovery receipt serialization failed'
  chmod 0600 "$pending" || review_required 'recovery receipt pending mode failed'
  fsync_file "$pending" || review_required 'recovery receipt pending sync failed'
  ln -- "$pending" "$json_pending" || review_required 'recovery receipt JSON pending race'
  fsync_file "$json_pending" || review_required 'recovery receipt JSON pending sync failed'
  fsync_dir "$directory" || review_required 'recovery receipt JSON pending directory sync failed'
  /bin/rm -f -- "$pending" || review_required 'recovery receipt temporary cleanup failed'
  fsync_dir "$directory" || review_required 'recovery receipt directory sync failed'
  recovery_make_digest_file "$json_pending" "$digest_pending" || review_required 'recovery receipt digest pending race'; recovery_reconcile_pair "$directory" || review_required 'recovery receipt publication failed'; cat "$directory/recovery-scan.json.sha256"
}
