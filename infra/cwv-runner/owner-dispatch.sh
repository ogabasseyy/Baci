#!/bin/sh
set -eu
umask 077
SCRIPT_DIR=$(CDPATH='' cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P); readonly SCRIPT_DIR
readonly VERIFIER="$SCRIPT_DIR/verify-owner-cli.sh"; readonly VPS_SSH="$SCRIPT_DIR/vps-ssh.sh"
readonly TASK9_OPERATIONS='list-attestation-runs dispatch-exact-run read-exact-run cancel-exact-run read-failed-job-evidence rerun-failed-exact-run list-runner-inventory read-exact-job list-exact-artifacts download-exact-artifact'
readonly TASK9_SOURCES='infra/cwv-runner/archive-index.mjs infra/cwv-runner/archive-link-validation.mjs infra/cwv-runner/archive-stream.mjs infra/cwv-runner/build-image.mjs infra/cwv-runner/campaign-accounting-contract.mjs infra/cwv-runner/campaign-capture-authority.mjs infra/cwv-runner/campaign-cron-tree.mjs infra/cwv-runner/campaign-lease-holder.sh infra/cwv-runner/campaign-network-contract.mjs infra/cwv-runner/campaign-ownership.mjs infra/cwv-runner/campaign-quiesce.sh infra/cwv-runner/campaign-restore-baseline.mjs infra/cwv-runner/campaign-restore-network.mjs infra/cwv-runner/campaign-restore.sh infra/cwv-runner/campaign-source-closure.mjs infra/cwv-runner/campaign-state-collisions.mjs infra/cwv-runner/campaign-state-journal-lock.mjs infra/cwv-runner/campaign-state.mjs infra/cwv-runner/campaign-terminal-cleanup.mjs infra/cwv-runner/campaign-traffic.mjs infra/cwv-runner/canonical-json.mjs infra/cwv-runner/command-settings-contract.mjs infra/cwv-runner/cron-inventory.json infra/cwv-runner/exact-run-accounting.mjs infra/cwv-runner/exact-run-contract-cli.mjs infra/cwv-runner/exact-run-contract.mjs infra/cwv-runner/exact-run-controller.sh infra/cwv-runner/exact-run-live-sample-contract.mjs infra/cwv-runner/exact-run-process-contract.mjs infra/cwv-runner/exact-run-rearm-contract.mjs infra/cwv-runner/exact-run-terminal-cleanup.sh infra/cwv-runner/exact-run-transition-contract.mjs infra/cwv-runner/image-archive-authority.mjs infra/cwv-runner/image-process-map.mjs infra/cwv-runner/image-projection-config.mjs infra/cwv-runner/image-projection.mjs infra/cwv-runner/install-prepare-acceptance.mjs infra/cwv-runner/install-prepare-content-cleanup-cli.mjs infra/cwv-runner/install-prepare-content-cleanup.mjs infra/cwv-runner/install-prepare-content-safety.mjs infra/cwv-runner/install-prepare-runtime-receipt.mjs infra/cwv-runner/install-prepare-store.mjs infra/cwv-runner/owner-api-transport-cli-state.mjs infra/cwv-runner/owner-api-transport-evidence.mjs infra/cwv-runner/owner-api-transport-failure.mjs infra/cwv-runner/owner-api-transport-hold.mjs infra/cwv-runner/owner-api-transport-http.mjs infra/cwv-runner/owner-api-transport-operation-evidence.mjs infra/cwv-runner/owner-api-transport-pagination.mjs infra/cwv-runner/owner-api-transport-primitives.mjs infra/cwv-runner/owner-api-transport-requests.mjs infra/cwv-runner/owner-api-transport-runtime.mjs infra/cwv-runner/owner-api-transport-security.mjs infra/cwv-runner/owner-api-transport-source.mjs infra/cwv-runner/owner-api-transport-zip.mjs infra/cwv-runner/owner-api-transport.mjs infra/cwv-runner/owner-dispatch.sh infra/cwv-runner/policy.schema.mjs infra/cwv-runner/registration-token-mount.mjs infra/cwv-runner/rootfs-projection-contract.mjs infra/cwv-runner/rootfs-source-inventory.mjs infra/cwv-runner/rootfs-source-membership-input.mjs infra/cwv-runner/rootfs-source-membership.mjs infra/cwv-runner/runner-runtime-archive-snapshot.mjs infra/cwv-runner/runner-runtime-identity-manifest.mjs infra/cwv-runner/runner-runtime-manifest-producer.mjs infra/cwv-runner/runner-runtime-manifest-receipt-reader.mjs infra/cwv-runner/runner-runtime-projection.mjs infra/cwv-runner/runner-runtime-receipt-contract.mjs infra/cwv-runner/source-archive.mjs infra/cwv-runner/source-manifest-git.mjs infra/cwv-runner/source-manifest-objects.mjs infra/cwv-runner/source-manifest-tree.mjs infra/cwv-runner/source-manifest.mjs infra/cwv-runner/source-tree-projection.mjs infra/cwv-runner/task9-bootstrap-runtime.mjs infra/cwv-runner/task9-bootstrap.mjs infra/cwv-runner/task9-owner-documents.mjs infra/cwv-runner/task9-source-authorization.mjs infra/cwv-runner/verify-owner-cli.sh infra/cwv-runner/vps-ssh.sh'
refuse() { /usr/bin/printf '%s\n' 'owner dispatch refused' >&2; exit 65; }
sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk 'NR==1 {print $1}'; }
json_get() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null || refuse; }
json_array() { /usr/bin/plutil -extract "$2" json -o - "$1" 2>/dev/null || refuse; }
file_mode() { /usr/bin/stat -f '%Lp' "$1" 2>/dev/null || refuse; }
file_owner() { /usr/bin/stat -f '%Su' "$1" 2>/dev/null || refuse; }
durable_sync() { path=$1 parent=$(/usr/bin/dirname -- "$path"); if [ -n "${node-}" ] && [ "$node" = "$transaction_dir/tools/node/bin/node" ] && [ -x "$node" ]; then "$node" -e 'const fs=require("node:fs"),path=process.argv[1],parent=process.argv[2];for(const [value,directory] of [[path,0],[parent,fs.constants.O_DIRECTORY]]){const descriptor=fs.openSync(value,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|directory);try{fs.fsyncSync(descriptor)}finally{fs.closeSync(descriptor)}}' "$path" "$parent"; else /bin/sync; fi; }; publish_once() { temporary=$1 output=$2; [ ! -e "$output" ] && [ ! -L "$output" ] || return 1; durable_sync "$temporary" && /bin/ln "$temporary" "$output" && durable_sync "$output" && /bin/rm -f -- "$temporary"; }
publish_text() { output=$1 bytes=$2; temporary=$(/usr/bin/mktemp "${output}.tmp.XXXXXX") || refuse; trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM; /usr/bin/printf '%s' "$bytes" >"$temporary" || refuse; /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || refuse; trap - EXIT HUP INT TERM; }
assert_transaction() { transaction_dir=$1; case "$transaction_dir" in (/private/tmp/baci-cwv-*) ;; (*) refuse;; esac; [ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(file_mode "$transaction_dir")" = 700 ] && [ "$(file_owner "$transaction_dir")" = "$(/usr/bin/id -un)" ] || refuse; }
wait_bounded_release() { release_wait_pid=$1 release_remaining_ms=$2 release_timer_node=${3-}; if [ "$release_remaining_ms" -le 0 ]; then /bin/kill -TERM "$release_wait_pid" 2>/dev/null || :; /bin/kill -KILL "$release_wait_pid" 2>/dev/null || :; wait "$release_wait_pid" 2>/dev/null || :; release_wait_pid=; /usr/bin/printf '%s\n' 'owner release timeout' >&2; return 124; fi; [ -n "$release_timer_node" ] || return 64; release_timed_out=0; trap 'release_timed_out=1; /bin/kill -TERM "$release_wait_pid" 2>/dev/null || :; /bin/kill -KILL "$release_wait_pid" 2>/dev/null || :' ALRM; "$release_timer_node" -e 'const shell=Number(process.ppid),ms=Number(process.argv[1]);if(!Number.isInteger(shell)||shell<2||!Number.isInteger(ms)||ms<1)process.exit(64);setTimeout(()=>{try{process.kill(process.ppid,"SIGALRM")}catch{}},ms)' "$release_remaining_ms" & release_wait_timer=$!; release_wait_status=0; wait "$release_wait_pid" || release_wait_status=$?; /bin/kill "$release_wait_timer" 2>/dev/null || :; wait "$release_wait_timer" 2>/dev/null || :; trap - ALRM; release_wait_timer=''; if [ "$release_timed_out" -eq 1 ]; then wait "$release_wait_pid" 2>/dev/null || :; release_wait_pid=''; /usr/bin/printf '%s\n' 'owner release timeout' >&2; return 124; fi; release_wait_pid=''; return "$release_wait_status"; }
assert_child_file() { file=$1
  case "$file" in ("$transaction_dir"/*) ;; (*) refuse;; esac; case "$file" in (*'/../'*|*'/./'*|*'//'*) refuse;; esac
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(file_owner "$file")" = "$(/usr/bin/id -un)" ] || refuse
  parent=$(/usr/bin/dirname -- "$file")
  while [ "$parent" != "$transaction_dir" ]; do
    case "$parent" in ("$transaction_dir"/*) ;; (*) refuse;; esac; [ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(file_owner "$parent")" = "$(/usr/bin/id -un)" ] || refuse; parent=$(/usr/bin/dirname -- "$parent")
  done
}
fetch() {
  url=$1 output=$2 expected=$3 origin_class=$4
  [ ! -e "$output" ] && [ ! -L "$output" ] || refuse; case "$origin_class:$url" in (gh:https://github.com/*|node:https://nodejs.org/*|keyring:https://raw.githubusercontent.com/*) ;; (*) refuse;; esac
  temporary=$(/usr/bin/mktemp "${output}.tmp.XXXXXX") || refuse
  trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM
  metadata=$(/usr/bin/curl -q --config /dev/null --noproxy '*' --proto '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 10 --max-time 30 --max-redirs 0 --write-out '%{http_code}\n%{redirect_url}' --output "$temporary" "$url" 2>/dev/null) || refuse
  status=$(/usr/bin/printf '%s\n' "$metadata" | /usr/bin/awk 'NR==1 {print} NR>2 {exit 1}'); redirect=$(/usr/bin/printf '%s\n' "$metadata" | /usr/bin/awk 'NR==2 {print} NR>2 {exit 1}')
  case "$status:$redirect" in (200:) ;; (301:https://release-assets.githubusercontent.com/*|302:https://release-assets.githubusercontent.com/*|303:https://release-assets.githubusercontent.com/*|307:https://release-assets.githubusercontent.com/*|308:https://release-assets.githubusercontent.com/*) [ "$origin_class" = gh ] || refuse; metadata=$(/usr/bin/curl -q --config /dev/null --noproxy '*' --proto '=https' --tlsv1.2 --fail --silent --show-error --connect-timeout 10 --max-time 30 --max-redirs 0 --write-out '%{http_code}\n%{redirect_url}' --output "$temporary" "$redirect" 2>/dev/null) || refuse; [ "$metadata" = 200 ] || refuse;; (*) refuse;; esac
  metadata='' redirect=''; [ "$(sha256 "$temporary")" = "$expected" ] || refuse
  /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || refuse
  trap - EXIT HUP INT TERM
}
verify_source_binding() {
  purpose=$1
  assert_child_file "$source_authorization"; assert_child_file "$source_authorization_sha256"
  stored=$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$source_authorization_sha256") || refuse
  [ "$stored" = "$(sha256 "$source_authorization")" ] && [ "$(json_get "$source_authorization" purpose)" = "$purpose" ] && [ "$(json_get "$source_authorization" policyFileSha256)" = "$(sha256 "$policy")" ] || refuse
  case $purpose in
    (task7-provisioning)
      expected_dispatcher="$transaction_dir/owner-dispatch.sh"; expected_verifier="$transaction_dir/verify-owner-cli.sh"
      expected_operations='["set-auditor-private-key","set-auditor-app-id","set-auditor-client-id","set-auditor-installation-id","read-auditor-app-registration","read-repository-retention","read-rollout-ruleset","create-owned-probe-tag-object","create-owned-probe-ref","read-owned-probe-ref","rollback-owned-probe-ref","upsert-rollout-ruleset","assert-owned-probe-duplicate-create","assert-owned-probe-update","assert-owned-probe-force-update","assert-owned-probe-delete"]'
      ;;
    (task9-exact-run)
      expected_dispatcher="$transaction_dir/authorized-source/infra/cwv-runner/owner-dispatch.sh"; expected_verifier="$transaction_dir/authorized-source/infra/cwv-runner/verify-owner-cli.sh"
      expected_operations='["list-attestation-runs","dispatch-exact-run","read-exact-run","cancel-exact-run","read-failed-job-evidence","rerun-failed-exact-run","list-runner-inventory","read-exact-job","list-exact-artifacts","download-exact-artifact"]'
      ;;
    (*) refuse;;
  esac
  [ "$SCRIPT_DIR/owner-dispatch.sh" = "$expected_dispatcher" ] && [ "$VERIFIER" = "$expected_verifier" ] || refuse
  assert_child_file "$expected_dispatcher"; assert_child_file "$expected_verifier"
  [ "$(json_get "$source_authorization" schemaVersion)" = 1 ] || refuse
  [ "$(json_array "$source_authorization" operationSet)" = "$expected_operations" ] || refuse
  case $purpose in (task9-exact-run) verify_task9_sources;; esac
}
verify_task9_sources() {
  index=0; task9_manifest_sha=''; for source_path in $TASK9_SOURCES; do
    [ "$(json_get "$source_authorization" "sourceFiles.$index.path")" = "$source_path" ] || refuse
    source_file="$transaction_dir/authorized-source/$source_path"; assert_child_file "$source_file"
    expected=$(json_get "$source_authorization" "sourceFiles.$index.sha256")
    printf '%s' "$expected" | /usr/bin/awk 'length == 64 && /^[0-9a-f]+$/ {valid=1} END {exit !valid}' || refuse
    [ "$(sha256 "$source_file")" = "$expected" ] || refuse
    [ "$source_path" != infra/cwv-runner/task9-source-authorization.mjs ] || task9_manifest_sha=$expected
    index=$((index + 1))
  done
  /usr/bin/plutil -extract "sourceFiles.$index.path" raw -o - "$source_authorization" >/dev/null 2>&1 && refuse; [ -n "$task9_manifest_sha" ] || refuse
}
# shellcheck disable=SC2016,SC2094
verify_task9_manifest() { node="$transaction_dir/tools/node/bin/node"; manifest="$transaction_dir/authorized-source/infra/cwv-runner/task9-source-authorization.mjs"; for file in "$node" "$manifest"; do assert_child_file "$file"; done; "$node" --input-type=module --eval 'import {createHash} from "node:crypto";import {fstatSync,lstatSync,readFileSync} from "node:fs";const [expected,authorization,authorizationSha256,sourceRoot,manifest]=process.argv.slice(1),same=(left,right)=>left.dev===right.dev&&left.ino===right.ino;if(!/^[a-f0-9]{64}$/.test(expected))throw new Error("source manifest refused");const held=fstatSync(3),current=lstatSync(manifest);if(current.isSymbolicLink()||!current.isFile()||!same(held,current))throw new Error("source manifest refused");const source=readFileSync(3);if(createHash("sha256").update(source).digest("hex")!==expected)throw new Error("source manifest refused");const application=await import(`data:text/javascript;base64,${source.toString("base64")}#sha256=${expected}`);if(typeof application.runTask9SourceAuthorizationCli!=="function")throw new Error("source manifest refused");await application.runTask9SourceAuthorizationCli(["verify","--authorization",authorization,"--authorization-sha256",authorizationSha256,sourceRoot]);' "$task9_manifest_sha" "$source_authorization" "$source_authorization_sha256" "$transaction_dir/authorized-source" "$manifest" 3<"$manifest" >/dev/null; }
prepare_gh() {
  fetch "$(json_get "$policy" supplyChainProvenance.ownerCli.checksumsUrl)" "$transaction_dir/gh-checksums.txt" "$(json_get "$policy" supplyChainProvenance.ownerCli.checksumsSha256)" gh
  fetch "$(json_get "$policy" supplyChainProvenance.ownerCli.archiveUrl)" "$transaction_dir/gh.tar.gz" "$(json_get "$policy" supplyChainProvenance.ownerCli.archiveSha256)" gh
  stage=$(/usr/bin/mktemp -d "$transaction_dir/gh-stage.XXXXXX") || refuse
  trap '/bin/rm -rf -- "$stage"' EXIT HUP INT TERM
  /usr/bin/unzip -q "$transaction_dir/gh.tar.gz" -d "$stage" || refuse
  extracted="$stage/gh_2.93.0_macOS_arm64/bin/gh"
  [ -f "$extracted" ] && [ ! -L "$extracted" ] || refuse
  [ "$(sha256 "$extracted")" = "$(json_get "$policy" supplyChainProvenance.ownerCli.binarySha256)" ] || refuse
  /bin/mkdir -p "$transaction_dir/tools/gh/bin"; /bin/chmod 0700 "$transaction_dir/tools" "$transaction_dir/tools/gh" "$transaction_dir/tools/gh/bin"
  /bin/cp -p -- "$extracted" "$transaction_dir/tools/gh/bin/gh"
  /bin/chmod 0500 "$transaction_dir/tools/gh/bin/gh"; /bin/rm -rf -- "$stage"; trap - EXIT HUP INT TERM; /bin/sync
}
prepare_node() {
  fetch "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Url)" "$transaction_dir/node.tar.xz" "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.checksumsUrl)" "$transaction_dir/node-shasums.txt" "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.signatureUrl)" "$transaction_dir/node-shasums.sig" "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.keyringUrl)" "$transaction_dir/node-keyring.kbx" "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" keyring
  version=$(json_get "$policy" supplyChain.node.version)
  [ "$version" = 24.18.0 ] || refuse
  archive_name="node-v${version}-darwin-arm64.tar.xz"
  archive_sha=$(sha256 "$transaction_dir/node.tar.xz")
  rows=$(/usr/bin/awk -v hash="$archive_sha" -v name="$archive_name" '$1 == hash && $2 == name {count++} END {print count+0}' "$transaction_dir/node-shasums.txt")
  [ "$rows" -eq 1 ] || refuse
  stage=$(/usr/bin/mktemp -d "$transaction_dir/node-stage.XXXXXX") || refuse
  trap '/bin/rm -rf -- "$stage"' EXIT HUP INT TERM
  /usr/bin/tar -tf "$transaction_dir/node.tar.xz" | /usr/bin/awk -v root="node-v${version}-darwin-arm64/" '
    /^[\/]/ || /(^|\/)\.\.?($|\/)/ || index($0, root) != 1 {exit 1}
    {count++} END {if (count == 0) exit 1}' || refuse
  /usr/bin/tar -xJf "$transaction_dir/node.tar.xz" -C "$stage" || refuse
  extracted="$stage/node-v${version}-darwin-arm64/bin/node"
  [ -f "$extracted" ] && [ ! -L "$extracted" ] || refuse
  [ "$($extracted --version 2>/dev/null)" = "v$version" ] || refuse
  /bin/mkdir -p "$transaction_dir/tools/node/bin"
  /bin/chmod 0700 "$transaction_dir/tools" "$transaction_dir/tools/node" "$transaction_dir/tools/node/bin"
  /bin/cp -p -- "$extracted" "$transaction_dir/tools/node/bin/node"
  /bin/chmod 0500 "$transaction_dir/tools/node/bin/node"
  binary_sha=$(sha256 "$transaction_dir/tools/node/bin/node")
  receipt=$(/usr/bin/printf '{"archiveSha256":"%s","binary":{"mode":500,"path":"tools/node/bin/node","sha256":"%s"},"checksumSha256":"%s","keyringSha256":"%s","schemaVersion":1,"signatureSha256":"%s","version":"%s"}' "$archive_sha" "$binary_sha" "$(sha256 "$transaction_dir/node-shasums.txt")" "$(sha256 "$transaction_dir/node-keyring.kbx")" "$(sha256 "$transaction_dir/node-shasums.sig")" "$version")
  /usr/bin/printf '%s' "$receipt" >"$transaction_dir/node-receipt.json"; /bin/chmod 0400 "$transaction_dir/node-receipt.json"; /usr/bin/printf '%s\n' "$(sha256 "$transaction_dir/node-receipt.json")" >"$transaction_dir/node-receipt.sha256"; /bin/chmod 0400 "$transaction_dir/node-receipt.sha256"
  /bin/rm -rf -- "$stage"; trap - EXIT HUP INT TERM; /bin/sync
}
verify_node() {
  node="$transaction_dir/tools/node/bin/node" node_receipt="$transaction_dir/node-receipt.json" node_receipt_sha="$transaction_dir/node-receipt.sha256"
  for file in "$node" "$node_receipt" "$node_receipt_sha" "$transaction_dir/node.tar.xz" \
    "$transaction_dir/node-shasums.txt" "$transaction_dir/node-shasums.sig" "$transaction_dir/node-keyring.kbx"; do assert_child_file "$file"; done
  [ "$(file_mode "$node")" = 500 ] && [ "$(file_mode "$node_receipt")" = 400 ] || refuse; stored=$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$node_receipt_sha") || refuse; [ "$stored" = "$(sha256 "$node_receipt")" ] || refuse
  [ "$(json_get "$node_receipt" schemaVersion)" = 1 ] && [ "$(json_get "$node_receipt" version)" = 24.18.0 ] || refuse
  [ "$(json_get "$node_receipt" archiveSha256)" = "$(sha256 "$transaction_dir/node.tar.xz")" ] || refuse
  [ "$(json_get "$node_receipt" checksumSha256)" = "$(sha256 "$transaction_dir/node-shasums.txt")" ] || refuse
  [ "$(json_get "$node_receipt" signatureSha256)" = "$(sha256 "$transaction_dir/node-shasums.sig")" ] || refuse
  [ "$(json_get "$node_receipt" keyringSha256)" = "$(sha256 "$transaction_dir/node-keyring.kbx")" ] || refuse
  [ "$(json_get "$node_receipt" binary.path)" = tools/node/bin/node ] || refuse
  [ "$(json_get "$node_receipt" binary.mode)" = 500 ] || refuse
  [ "$(json_get "$node_receipt" binary.sha256)" = "$(sha256 "$node")" ] || refuse
  [ "$(json_get "$node_receipt" archiveSha256)" = "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" ] || refuse
  [ "$(json_get "$node_receipt" checksumSha256)" = "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" ] || refuse
  [ "$(json_get "$node_receipt" signatureSha256)" = "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" ] || refuse
  [ "$(json_get "$node_receipt" keyringSha256)" = "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" ] || refuse
  [ "$($node --version 2>/dev/null)" = v24.18.0 ] || refuse
}
adopt_task9_node() { bundle=$1; node="$bundle/node"; provenance="$bundle/node-provenance.json"; for file in "$node" "$provenance"; do assert_child_file "$file"; done; /bin/mkdir -p "$transaction_dir/tools/node/bin"; /bin/chmod 0700 "$transaction_dir/tools" "$transaction_dir/tools/node" "$transaction_dir/tools/node/bin"; /bin/cp -p -- "$node" "$transaction_dir/tools/node/bin/node"; /bin/cp -p -- "$provenance" "$transaction_dir/node-receipt.json"; /bin/chmod 0500 "$transaction_dir/tools/node/bin/node"; /bin/chmod 0400 "$transaction_dir/node-receipt.json"; /usr/bin/printf '%s\n' "$(sha256 "$transaction_dir/node-receipt.json")" >"$transaction_dir/node-receipt.sha256"; /bin/chmod 0400 "$transaction_dir/node-receipt.sha256"; /bin/sync; }
verify_task9_node() { node="$transaction_dir/tools/node/bin/node"; receipt="$transaction_dir/node-receipt.json"; receipt_sha="$transaction_dir/node-receipt.sha256"; for file in "$node" "$receipt" "$receipt_sha"; do assert_child_file "$file"; done; [ "$(file_mode "$node")" = 500 ] && [ "$(file_mode "$receipt")" = 400 ] || refuse; [ "$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$receipt_sha")" = "$(sha256 "$receipt")" ] || refuse; [ "$(sha256 "$receipt")" = "$(json_get "$source_authorization" provenance.nodeProvenanceSha256)" ] && [ "$(json_get "$receipt" sha256)" = "$(sha256 "$node")" ] && [ "$(json_get "$receipt" version)" = "$(json_get "$policy" supplyChain.node.version)" ] || refuse; }
prepare() {
  prepare_mode=$1; shift
  transaction_dir='' policy='' source_authorization='' source_authorization_sha256=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in (--transaction-dir) transaction_dir=$value;; (--policy) policy=$value;; (--source-authorization) source_authorization=$value;; (--source-authorization-sha256) source_authorization_sha256=$value;; (*) refuse;; esac
  done
  [ -n "$transaction_dir$policy$source_authorization$source_authorization_sha256" ] || refuse
  assert_transaction "$transaction_dir"; assert_child_file "$policy"
  case $prepare_mode in
    (cli)
      verify_source_binding task7-provisioning; prepare_gh
      "$VERIFIER" --policy "$policy" --checksum-file "$transaction_dir/gh-checksums.txt" \
        --archive "$transaction_dir/gh.tar.gz" --receipt "$transaction_dir/gh-receipt.json" \
        --source-authorization "$source_authorization" \
        --source-authorization-sha256 "$source_authorization_sha256" \
        --purpose task7-provisioning --verify-only
      prepare_node
      ;;
    (task9-cli) [ "$policy" = "$transaction_dir/authorized-source/infra/cwv-runner/policy.json" ] && [ "$source_authorization" = "$transaction_dir/authorized-source/source-authorization.json" ] && [ "$source_authorization_sha256" = "$transaction_dir/authorized-source/source-authorization.sha256" ] || refuse; verify_source_binding task9-exact-run; verify_task9_manifest; prepare_gh
      "$VERIFIER" --policy "$policy" --checksum-file "$transaction_dir/gh-checksums.txt" --archive "$transaction_dir/gh.tar.gz" --receipt "$transaction_dir/gh-receipt.json" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256" --purpose task9-exact-run --verify-only ;;
    (*) refuse;;
  esac
}
prepare_task9_bootstrap_node() {
  [ "$#" -eq 6 ] && [ "$1" = --transaction-dir ] && [ "$3" = --policy ] && [ "$5" = --reviewed-policy-sha256 ] || refuse; transaction_dir=$2; policy=$4; reviewed_policy_sha=$6
  assert_transaction "$transaction_dir"; [ "$policy" = "$transaction_dir/policy.json" ] || refuse; assert_child_file "$policy"; [ "$(file_mode "$policy")" = 400 ] || refuse
  /usr/bin/printf '%s' "$reviewed_policy_sha" | /usr/bin/awk 'length == 64 && /^[0-9a-f]+$/ {valid=1} END {exit !valid}' || refuse; [ "$(sha256 "$policy")" = "$reviewed_policy_sha" ] || refuse
  fetch "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Url)" "$transaction_dir/node.tar.xz" "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.checksumsUrl)" "$transaction_dir/node-shasums.txt" "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.signatureUrl)" "$transaction_dir/node-shasums.sig" "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" node
  fetch "$(json_get "$policy" supplyChainProvenance.node.keyringUrl)" "$transaction_dir/node-keyring.kbx" "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" keyring
  "$VERIFIER" --prepare-task9-bootstrap-node --root "$transaction_dir" --policy "$policy" --reviewed-policy-sha256 "$reviewed_policy_sha"
}
compose_task9_bundle() { [ "$#" -ge 14 ] && [ "$1" = --transaction-dir ] && [ "$3" = --policy ] && [ "$5" = --reviewed-policy-sha256 ] && [ "$7" = --reviewed-helper-sha256 ] && [ "$9" = --reviewed-launcher-sha256 ] && [ "${11}" = --reviewed-composer-sha256 ] && [ "${13}" = -- ] || refuse; transaction_dir=$2; policy=$4; reviewed_policy_sha=$6; reviewed_helper_sha=$8; reviewed_launcher_sha=${10}; reviewed_composer_sha=${12}; shift 13; assert_transaction "$transaction_dir"; [ "$policy" = "$transaction_dir/policy.json" ] || refuse; assert_child_file "$policy"; [ "$(file_mode "$policy")" = 400 ] && [ "$(sha256 "$policy")" = "$reviewed_policy_sha" ] || refuse; policy_snapshot="$transaction_dir/policy-compose.json"; [ ! -e "$policy_snapshot" ] && [ ! -L "$policy_snapshot" ] || refuse; /bin/cp -p -- "$policy" "$policy_snapshot"; /bin/chmod 0400 "$policy_snapshot"; [ "$(sha256 "$policy_snapshot")" = "$reviewed_policy_sha" ] || refuse; policy_for_prepare=$policy; policy=$policy_snapshot; prepare_gh; [ "$(sha256 "$transaction_dir/tools/gh/bin/gh")" = "$(json_get "$policy" supplyChainProvenance.ownerCli.binarySha256)" ] || refuse; policy=$policy_for_prepare; [ "$(sha256 "$policy")" = "$reviewed_policy_sha" ] || refuse; helper="$SCRIPT_DIR/task9-compose-bundle.sh"; helper_copy="$transaction_dir/task9-compose-bundle.sh"; [ -f "$helper" ] && [ ! -L "$helper" ] && [ "$(sha256 "$helper")" = "$reviewed_helper_sha" ] || refuse; [ ! -e "$helper_copy" ] && [ ! -L "$helper_copy" ] || refuse; /bin/cp -p -- "$helper" "$helper_copy"; /bin/chmod 0500 "$helper_copy"; [ "$(sha256 "$helper_copy")" = "$reviewed_helper_sha" ] || refuse; exec "$helper_copy" --transaction-dir "$transaction_dir" --policy "$policy" --reviewed-policy-sha256 "$reviewed_policy_sha" --source-root "$SCRIPT_DIR" --reviewed-helper-sha256 "$reviewed_helper_sha" --reviewed-launcher-sha256 "$reviewed_launcher_sha" --reviewed-composer-sha256 "$reviewed_composer_sha" --github-sha256 "$(sha256 "$transaction_dir/tools/gh/bin/gh")" -- "$@"; }
initialize_task9() {
  transaction_dir='' state='' state_sha='' source_authorization='' source_authorization_sha256=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in
      (--transaction-dir) transaction_dir=$value;; (--state) state=$value;;
      (--state-sha256) state_sha=$value;; (--source-authorization) source_authorization=$value;;
      (--source-authorization-sha256) source_authorization_sha256=$value;; (*) refuse;;
    esac
  done
  [ -n "$transaction_dir$state$state_sha$source_authorization$source_authorization_sha256" ] || refuse
  assert_transaction "$transaction_dir"
  [ "$state" = "$transaction_dir/task9-state.json" ] && [ "$state_sha" = "$transaction_dir/task9-state.sha256" ] || refuse
  for file in "$source_authorization" "$source_authorization_sha256"; do assert_child_file "$file"; done
  policy="$transaction_dir/authorized-source/infra/cwv-runner/policy.json"; assert_child_file "$policy"
  verify_task9_node; verify_source_binding task9-exact-run
  node="$transaction_dir/tools/node/bin/node"; transport="$transaction_dir/authorized-source/infra/cwv-runner/owner-api-transport.mjs"
  for file in "$node" "$transport"; do assert_child_file "$file"; done
  [ ! -e "$state" ] && [ ! -e "$state_sha" ] || refuse
  verify_task9_sources
  "$node" "$transport" --initialize-state --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256" --state "$state" --state-sha256 "$state_sha"
  for file in "$state" "$state_sha"; do assert_child_file "$file"; done
}
bootstrap_task9() {
  transaction_dir='' bundle='' bundle_id='' envelope='' envelope_sha='' reviewed_envelope_sha=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in
      (--transaction-dir) transaction_dir=$value;; (--bundle-dir) bundle=$value;; (--bundle-id) bundle_id=$value;; (--envelope) envelope=$value;;
      (--envelope-sha256) envelope_sha=$value;; (--reviewed-envelope-sha256) reviewed_envelope_sha=$value;; (*) refuse;;
    esac
  done
  [ -n "$transaction_dir$bundle$bundle_id$envelope$envelope_sha$reviewed_envelope_sha" ] || refuse
  assert_transaction "$transaction_dir"; [ "$bundle" = "$transaction_dir/task9-bundle" ] || refuse
  for file in "$envelope" "$envelope_sha"; do assert_child_file "$file"; [ "$(file_mode "$file")" = 400 ] || refuse; done; stored=$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$envelope_sha") || refuse; [ "$stored" = "$reviewed_envelope_sha" ] && [ "$(sha256 "$envelope")" = "$reviewed_envelope_sha" ] || refuse
  node="$bundle/node"; launcher_source="$SCRIPT_DIR/task9-bootstrap-runtime.mjs"; launcher="$transaction_dir/task9-bootstrap-launcher.mjs"
  for file in "$node" "$launcher_source"; do assert_child_file "$file"; done; [ "$(file_mode "$node")" = 500 ] && [ "$(file_mode "$launcher_source")" = 644 ] && [ ! -e "$launcher" ] && [ ! -L "$launcher" ] || refuse
  /bin/cp -p -- "$launcher_source" "$launcher"; /bin/chmod 0400 "$launcher"; /bin/sync; assert_child_file "$launcher"; reviewed_launcher_sha=$(json_get "$envelope" runtime.launcherSha256); /usr/bin/printf '%s' "$reviewed_launcher_sha" | /usr/bin/awk 'length == 64 && /^[0-9a-f]+$/ {valid=1} END {exit !valid}' || refuse; [ "$(file_mode "$launcher")" = 400 ] && [ "$(sha256 "$launcher")" = "$reviewed_launcher_sha" ] || refuse
  "$node" "$launcher" --authorize --bundle-id "$bundle_id" --reviewed-envelope-sha256 "$reviewed_envelope_sha" --reviewed-launcher-sha256 "$reviewed_launcher_sha" --bundle-dir "$bundle" --envelope "$envelope" --envelope-sha256 "$envelope_sha" --owner "$(/usr/bin/id -u)"
  for file in source-authorization.json source-authorization.sha256 source-tree.sha256; do assert_child_file "$transaction_dir/authorized-source/$file"; done
  adopt_task9_node "$bundle"
  "$transaction_dir/authorized-source/infra/cwv-runner/owner-dispatch.sh" --prepare-task9-cli --transaction-dir "$transaction_dir" --policy "$transaction_dir/authorized-source/infra/cwv-runner/policy.json" --source-authorization "$transaction_dir/authorized-source/source-authorization.json" --source-authorization-sha256 "$transaction_dir/authorized-source/source-authorization.sha256"
}
task9() {
  operation=$1; shift
  case " $TASK9_OPERATIONS " in (*" $operation "*) ;; (*) refuse;; esac
  state='' state_sha='' source_authorization='' source_authorization_sha256=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in
      (--state) state=$value;; (--state-sha256) state_sha=$value;;
      (--source-authorization) source_authorization=$value;;
      (--source-authorization-sha256) source_authorization_sha256=$value;; (*) refuse;;
    esac
  done
  [ -n "$state$state_sha$source_authorization$source_authorization_sha256" ] || refuse
  transaction_dir=$(/usr/bin/dirname -- "$state"); assert_transaction "$transaction_dir"
  [ "$state_sha" = "$transaction_dir/task9-state.sha256" ] || refuse
  for file in "$state" "$state_sha" "$source_authorization" "$source_authorization_sha256"; do assert_child_file "$file"; done
  policy="$transaction_dir/authorized-source/infra/cwv-runner/policy.json"; assert_child_file "$policy"
  verify_task9_node
  verify_source_binding task9-exact-run
  node="$transaction_dir/tools/node/bin/node"; gh="$transaction_dir/tools/gh/bin/gh"; manifest="$transaction_dir/authorized-source/infra/cwv-runner/task9-source-authorization.mjs"
  for file in "$node" "$gh" "$manifest"; do assert_child_file "$file"; done
  [ "$(json_array "$source_authorization" operationSet)" = '["list-attestation-runs","dispatch-exact-run","read-exact-run","cancel-exact-run","read-failed-job-evidence","rerun-failed-exact-run","list-runner-inventory","read-exact-job","list-exact-artifacts","download-exact-artifact"]' ] || refuse
  verify_task9_sources; manifest_sha=$task9_manifest_sha
  # shellcheck disable=SC2016,SC2094
  ( verifier_status=$(/usr/bin/mktemp "$transaction_dir/task9-verifier-status.XXXXXX") || refuse; trap '/bin/rm -f -- "$verifier_status"' EXIT HUP INT TERM; set +e
    ( "$VERIFIER" --policy "$policy" --checksum-file "$transaction_dir/gh-checksums.txt" --archive "$transaction_dir/gh.tar.gz" --receipt "$transaction_dir/gh-receipt.json" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256" --purpose task9-exact-run --emit-task9-token; verifier_code=$?; /usr/bin/printf '%s\n' "$verifier_code" >"$verifier_status"; exit "$verifier_code" ) |
      "$node" --input-type=module --eval 'import {createHash} from "node:crypto";import {fstatSync,lstatSync,readFileSync} from "node:fs";const [expected,authorization,authorizationSha256,sourceRoot,operation,state,stateSha,manifest]=process.argv.slice(1),same=(left,right)=>left.dev===right.dev&&left.ino===right.ino;if(!/^[a-f0-9]{64}$/.test(expected))throw new Error("source manifest refused");const held=fstatSync(3),current=lstatSync(manifest);if(current.isSymbolicLink()||!current.isFile()||!same(held,current))throw new Error("source manifest refused");const source=readFileSync(3);if(createHash("sha256").update(source).digest("hex")!==expected)throw new Error("source manifest refused");const application=await import(`data:text/javascript;base64,${source.toString("base64")}#sha256=${expected}`);if(typeof application.runTask9SourceAuthorizationCli!=="function")throw new Error("source manifest refused");await application.runTask9SourceAuthorizationCli(["execute","--authorization",authorization,"--authorization-sha256",authorizationSha256,"--source-root",sourceRoot,"--","--operation",operation,"--state",state,"--state-sha256",stateSha,"--token-fd","0"]);' "$manifest_sha" "$source_authorization" "$source_authorization_sha256" "$transaction_dir/authorized-source" "$operation" "$state" "$state_sha" "$manifest" 3<"$manifest"; consumer_code=$?; verifier_code=$(/usr/bin/awk 'NR==1 && /^[0-9]+$/ {print; valid=1; next} {exit 1} END {exit !valid}' "$verifier_status")
    [ "$verifier_code" = 0 ] && [ "$consumer_code" = 0 ]
  ) || refuse
}
task9_until() { operation=$1; shift; while :; do task9 "$operation" "$@"; case $operation in (list-attestation-runs) phase=$(json_get "$state" phase); [ "$phase" = QUIESCENT ] && break; case $phase in (QUEUED|RUNNING) [ "$(json_get "$state" postDispatchEvidence.run.id)" = "$(json_get "$state" run.id)" ] && [ "$(json_get "$state" postDispatchEvidence.run.attempt)" = "$(json_get "$state" run.attempt)" ] && break;; (DISPATCH_ACCEPTED|DISPATCH_INDETERMINATE) case $phase in (DISPATCH_ACCEPTED) deadline=$(json_get "$state" queueDeadlineMonotonicMs);; (DISPATCH_INDETERMINATE) deadline=$(json_get "$state" dispatchIntent.reconcileDeadlineMonotonicMs);; esac; now=$("$node" -e 'process.stdout.write(String(Number(process.hrtime.bigint()/1000000n)))') || refuse; [ "$now" -lt "$deadline" ] || refuse; /bin/sleep 1;; (*) refuse;; esac;; (list-runner-inventory) json_get "$state" runnerEvidence.runnerId >/dev/null 2>&1 && break;; (*) break;; esac; done; }
task9_until_attempt_two() { failed_run_id=$1; shift; count=0; while [ "$(json_get "$state" phase)" = RERUN_REQUESTED ]; do [ "$count" -lt 120 ] || { task9_cancel; task9_manual; task9_abort; refuse; }; task9 read-exact-run "$@"; count=$((count + 1)); [ "$(json_get "$state" phase)" = RERUN_REQUESTED ] && /bin/sleep 1; done; [ "$(json_get "$state" run.attempt)" = 2 ] && [ "$(json_get "$state" run.id)" = "$failed_run_id" ] || { task9_cancel; task9_manual; task9_abort; refuse; }; }
task9_doc() (
  mode=$1 output=$2; [ ! -e "$output" ] && [ ! -L "$output" ] || refuse; temporary=$(/usr/bin/mktemp "${output}.tmp.XXXXXX") || refuse; trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM; documents="$transaction_dir/authorized-source/infra/cwv-runner/task9-owner-documents.mjs"; assert_child_file "$documents"; [ "$(file_mode "$documents")" = 644 ] || refuse; verify_task9_sources; suffix="-attempt-$(json_get "$state" run.attempt)"
  case $mode in (begin) "$node" "$documents" --begin --state "$state" --state-sha256 "$state_sha" >"$temporary";; (rearm) "$node" "$documents" --rearm --state "$state" --state-sha256 "$state_sha" >"$temporary";; (admission) "$node" "$documents" --admission --state "$state" --state-sha256 "$state_sha" --challenge "$transaction_dir/root-admission-challenge$suffix.json" >"$temporary";; (inventory) "$node" "$documents" --inventory --state "$state" --state-sha256 "$state_sha" --hold "$transaction_dir/root-hold$suffix.json" >"$temporary";; (*) refuse;; esac || refuse
  /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || refuse; trap - EXIT HUP INT TERM; assert_child_file "$output"
)
task9_root() (
  mode=$1 input=$2 output=$3; [ ! -e "$output" ] && [ ! -L "$output" ] || refuse; temporary=$(/usr/bin/mktemp "${output}.tmp.XXXXXX") || refuse; trap '[ -z "${release_wait_pid-}" ] || /bin/kill "$release_wait_pid" 2>/dev/null || :; [ -z "${release_wait_pid-}" ] || wait "$release_wait_pid" 2>/dev/null || :; [ -z "${release_wait_timer-}" ] || /bin/kill "$release_wait_timer" 2>/dev/null || :; [ -z "${release_wait_timer-}" ] || wait "$release_wait_timer" 2>/dev/null || :; /bin/rm -f -- "$temporary"' EXIT HUP INT TERM; vps="$transaction_dir/authorized-source/infra/cwv-runner/vps-ssh.sh"; [ "$vps" = "$VPS_SSH" ] || refuse; assert_child_file "$vps"; [ "$(file_mode "$vps")" = 755 ] || refuse; verify_task9_sources
  case $mode in (begin) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --begin $campaign_id";; (rearm) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --rearm $campaign_id";; (admit) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --admit $campaign_id";; (release) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --release $campaign_id";; (complete) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --complete $campaign_id";; (abort) command="exec /srv/baci-cwv/sealed/exact-run-controller.sh --abort $campaign_id";; (*) refuse;; esac
  if [ "$mode" = release ]; then "$VPS_SSH" -- "$command" <"$input" >"$temporary" & release_pid=$!; release_wait_pid=$release_pid; for second in 0 1 2 3 4 5; do acknowledgement=$(/usr/bin/awk 'NR == 1 { print; exit }' "$temporary" 2>/dev/null || :); [ "$acknowledgement" = acknowledged ] && break; [ "$second" = 5 ] || /bin/sleep 1; done; [ "$acknowledgement" = acknowledged ] || { /bin/kill "$release_pid" 2>/dev/null || :; wait "$release_pid" 2>/dev/null || :; release_wait_pid=; refuse; }; release_now=$("$node" -e 'process.stdout.write(String(Number(process.hrtime.bigint()/1000000n)))') || refuse; release_remaining_ms=$(( $(json_get "$state" deadlineMonotonicMs) - release_now )); wait_bounded_release "$release_pid" "$release_remaining_ms" "$node" || refuse; elif [ "$mode" = begin ]; then "$VPS_SSH" -- "$command" <"$input" >"$temporary" || "$VPS_SSH" -- "$command" <"$input" >"$temporary"; elif [ -n "$input" ]; then "$VPS_SSH" -- "$command" <"$input" >"$temporary"; else "$VPS_SSH" -- "$command" >"$temporary"; fi; /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || refuse; trap - EXIT HUP INT TERM; assert_child_file "$output"
); task9_abort_exchange() { label=$1; attempt=$(json_get "$state" run.attempt); suffix="-attempt-$attempt"; bytes=$(/usr/bin/printf '{"admissionId":"%s","attempt":%s,"runId":%s,"schemaVersion":1,"stateGeneration":%s}' "$(json_get "$state" admissionId)" "$attempt" "$(json_get "$state" run.id)" "$(json_get "$state" generation)"); publish_text "$transaction_dir/root-$label-trigger$suffix.json" "$bytes"; abort_receipts="$transaction_dir/root-$label-receipts$suffix.json"; task9_root abort "$transaction_dir/root-$label-trigger$suffix.json" "$abort_receipts"; }
task9_abort() { [ "${task9_root_started-0}" = 1 ] || return 0; task9_abort_exchange abort >/dev/null 2>&1 || :; task9_root_started=0; }
task9_cancel() { phase=$(/usr/bin/plutil -extract phase raw -o - "$state" 2>/dev/null || :); case $phase in (DISPATCH_ACCEPTED|QUEUED|RUNNING|RERUN_INTENT|RERUN_REQUESTED) (task9 cancel-exact-run --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256") >/dev/null 2>&1 || { task9_manual bounded-cleanup-unconfirmed; return; }; phase=$(json_get "$state" phase);; (CANCEL_INTENT) task9_manual cancel-response-loss; return;; esac; case $phase in (CANCEL_ACCEPTED) count=0; while [ "$(json_get "$state" phase)" = CANCEL_ACCEPTED ]; do [ "$count" -lt 30 ] || { task9_manual cancellation-unconfirmed; return; }; (task9 read-exact-run --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256") >/dev/null 2>&1 || { task9_manual cancellation-unconfirmed; return; }; count=$((count + 1)); [ "$(json_get "$state" phase)" = CANCEL_ACCEPTED ] && /bin/sleep 1; done; if [ "$(json_get "$state" phase)" = CANCELED ]; then task9_cleanup_confirmed=1; else task9_manual cancellation-unconfirmed; fi;; esac; }
task9_manual() { [ "${task9_cleanup_confirmed-0}" = 0 ] || return 0; [ -n "${transaction_dir-}" ] && [ -d "$transaction_dir" ] || return 0; output="$transaction_dir/task9-manual-reconciliation.json"; [ ! -e "$output" ] && [ ! -L "$output" ] || return 0; reason=${1-controller-or-release-failure}; if run_id=$(/usr/bin/plutil -extract run.id raw -o - "$state" 2>/dev/null); then attempt=$(json_get "$state" run.attempt); admission=$(json_get "$state" admissionId); generation=$(json_get "$state" generation); digest=$(json_get "$state" stateDigest); active_phase=$(json_get "$state" phase); operational=$(/usr/bin/plutil -extract operationalDeadlineMonotonicMs raw -o - "$state" 2>/dev/null || json_get "$state" deadlineMonotonicMs); cleanup=$(/usr/bin/plutil -extract cleanupDeadlineMonotonicMs raw -o - "$state" 2>/dev/null || /usr/bin/printf '%s' "$((operational + 30000))"); bytes=$(/usr/bin/printf '{"admissionId":"%s","attempt":%s,"cleanupDeadlineMonotonicMs":%s,"observedPhase":"%s","operationalDeadlineMonotonicMs":%s,"phase":"MANUAL_RECONCILIATION","reason":"%s","runId":%s,"schemaVersion":1,"stateDigest":"%s","stateGeneration":%s}' "$admission" "$attempt" "$cleanup" "$active_phase" "$operational" "$reason" "$run_id" "$digest" "$generation"); else bytes='{"phase":"MANUAL_RECONCILIATION","reason":"controller-or-release-failure","schemaVersion":1}'; fi; publish_text "$output" "$bytes" || return 0; }
# shellcheck disable=SC2015,SC2016
task9_failure_receipts() { task9_abort_exchange failure; "$node" -e 'const fs=require("fs"),crypto=require("crypto"),dir=process.argv[1],s=JSON.parse(fs.readFileSync(process.argv[2])),o=JSON.parse(fs.readFileSync(process.argv[3])),x=`-attempt-${s.run.attempt}`,c=v=>Array.isArray(v)?`[${v.map(c)}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`)}}`:JSON.stringify(v),put=(n,v)=>{const b=Buffer.from(c(v)),p=`${dir}/${n}${x}`,t=`${p}.tmp-${process.pid}`,fd=fs.openSync(t,"wx",0o400);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.linkSync(t,`${p}.json`);fs.unlinkSync(t);const d=crypto.createHash("sha256").update(b).digest("hex"),q=`${p}.sha256`,u=`${q}.tmp-${process.pid}`,df=fs.openSync(u,"wx",0o400);try{fs.writeFileSync(df,d);fs.fsyncSync(df)}finally{fs.closeSync(df)}fs.linkSync(u,q);fs.unlinkSync(u)};put("root-channel",{authenticated:true,channel:"ssh-controller",receivedMonotonicMs:Number(process.hrtime.bigint()/1000000n),transactionId:s.sourceAuthorization.transactionId});put("root-terminal-runtime",o.runtime);put("root-restore",o.restore)' "$transaction_dir" "$state" "$abort_receipts"; durable_sync "$transaction_dir"; }
# shellcheck disable=SC2016
task9_completion_trigger() { output="$transaction_dir/root-completion-trigger.json"; [ "$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$state_sha")" = "$(sha256 "$state")  task9-state.json" ] || refuse; temporary=$(/usr/bin/mktemp "$transaction_dir/root-completion-trigger.XXXXXX") || refuse; "$node" -e 'const fs=require("fs"),crypto=require("crypto"),b=fs.readFileSync(process.argv[1]),s=JSON.parse(b),c=x=>Array.isArray(x)?`[${x.map(c)}]`:x&&typeof x==="object"?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${c(x[k])}`)}}`:JSON.stringify(x),h=x=>crypto.createHash("sha256").update(x).digest("hex");if(s.phase!=="EVIDENCE_VERIFIED"||!s.artifactReadbackEvidence||!s.ownerEvidenceHandoff||s.ownerEvidenceHandoff.terminalGeneration!==s.generation||s.artifactReadbackEvidence.ownerHandoffSha256!==h(c(s.ownerEvidenceHandoff)))process.exit(65);process.stdout.write(c({admissionId:s.admissionId,artifactReadbackEvidenceSha256:h(c(s.artifactReadbackEvidence)),attempt:s.run.attempt,ownerEvidenceHandoffSha256:h(c(s.ownerEvidenceHandoff)),ownerStateSha256:h(b),runId:s.run.id,schemaVersion:1,stateGeneration:s.generation}))' "$state" >"$temporary" || refuse; owner_handoff=$("$node" -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1])),c=x=>Array.isArray(x)?`[${x.map(c)}]`:x&&typeof x==="object"?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${c(x[k])}`)}}`:JSON.stringify(x);process.stdout.write(c(s.ownerEvidenceHandoff))' "$state") || refuse; readback=$("$node" -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1])),c=x=>Array.isArray(x)?`[${x.map(c)}]`:x&&typeof x==="object"?`{${Object.keys(x).sort().map(k=>`${JSON.stringify(k)}:${c(x[k])}`)}}`:JSON.stringify(x);process.stdout.write(c(s.artifactReadbackEvidence))' "$state") || refuse
# shellcheck disable=SC2016
  publish_text "$transaction_dir/owner-evidence-handoff.json" "$owner_handoff"; publish_text "$transaction_dir/artifact-readback-evidence.json" "$readback"; publish_text "$transaction_dir/h0-runner-attestation.json" "$(json_get "$state" ownerEvidenceHandoff.canonicalMember)"; [ "$(sha256 "$transaction_dir/h0-runner-attestation.json")" = "$(json_get "$state" ownerEvidenceHandoff.memberSha256)" ] || refuse; /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || refuse; }; task9_success_handoff() { evidence_directory=${TASK9_EVIDENCE_DIRECTORY-${evidence_directory-}}; [ -n "$evidence_directory" ] || refuse; state_cleanup="$SCRIPT_DIR/owner-api-transport-cli-state.mjs"; [ -f "$state_cleanup" ] && [ ! -L "$state_cleanup" ] && [ "$(file_mode "$state_cleanup")" = 644 ] && [ "$(file_owner "$state_cleanup")" = "$(/usr/bin/id -un)" ] || refuse; if ! { [ "$(file_mode "$state_cleanup")" = 644 ] && { [ ! -e "$evidence_directory" ] || { [ -d "$evidence_directory" ] && [ ! -L "$evidence_directory" ] && [ -f "$evidence_directory/task9-cleanup-pending.json" ] && [ ! -L "$evidence_directory/task9-cleanup-pending.json" ] && [ ! -e "$evidence_directory/task9-cleanup-complete.json" ]; }; }; }; then refuse; fi; "$node" --input-type=module -e 'import {pathToFileURL} from "node:url";const [module,evidenceDirectory,statePath,stateShaPath]=process.argv.slice(1);const {publishTask9SuccessHandoff}=await import(pathToFileURL(module).href);publishTask9SuccessHandoff({evidenceDirectory,statePath,stateShaPath});' "$state_cleanup" "$evidence_directory" "$state" "$state_sha" || refuse; }
task9_runner_hold() { "$node" -e 'const fs=require("fs"),crypto=require("crypto"),dir=process.argv[1],s=JSON.parse(fs.readFileSync(process.argv[2])),o=JSON.parse(fs.readFileSync(process.argv[3])),x=`-attempt-${s.run.attempt}`,c=v=>Array.isArray(v)?`[${v.map(c)}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`)}}`:JSON.stringify(v),put=(n,v)=>{const b=Buffer.from(c(v)),p=`${dir}/${n}${x}`,t=`${p}.tmp-${process.pid}`,fd=fs.openSync(t,"wx",0o400);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.linkSync(t,`${p}.json`);fs.unlinkSync(t);const d=crypto.createHash("sha256").update(b).digest("hex"),q=`${p}.sha256`,u=`${q}.tmp-${process.pid}`,df=fs.openSync(u,"wx",0o400);try{fs.writeFileSync(df,d);fs.fsyncSync(df)}finally{fs.closeSync(df)}fs.linkSync(u,q);fs.unlinkSync(u)};put("root-runner-hold-channel",{authenticated:true,channel:"ssh-controller",receivedMonotonicMs:Number(process.hrtime.bigint()/1000000n),transactionId:s.sourceAuthorization.transactionId});put("root-runner-hold",o)' "$transaction_dir" "$state" "$transaction_dir/root-hold-attempt-$(json_get "$state" run.attempt).json"; durable_sync "$transaction_dir"; }
task9_terminal() { while :; do task9 read-exact-run --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; phase=$(json_get "$state" phase); case $phase in (COMPLETED|FAILED|CANCELED) break;; (QUEUED|RUNNING) /bin/sleep 1;; (*) task9_manual; task9_abort; refuse;; esac; done
  case $phase in
    (COMPLETED) task9 read-exact-job --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9 list-exact-artifacts --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9 download-exact-artifact --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9_completion_trigger; task9_root complete "$transaction_dir/root-completion-trigger.json" "$transaction_dir/root-terminal.json"; task9_success_handoff; task9_root_started=0;;
    (FAILED) attempt=$(json_get "$state" run.attempt); [ "$attempt" = 1 ] || { task9_manual; task9_abort; refuse; }; failed_run_id=$(json_get "$state" run.id); task9_failure_receipts; task9_root_started=0; task9 read-failed-job-evidence --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9 rerun-failed-exact-run --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9_until_attempt_two "$failed_run_id" --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9_until list-attestation-runs --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; [ "$(json_get "$state" run.attempt)" = 2 ] && [ "$(json_get "$state" run.id)" = "$failed_run_id" ] || refuse; rerun_pending=1;; (CANCELED) task9_manual; task9_abort; refuse;; (*) task9_manual; task9_abort; refuse;; esac
}
# shellcheck disable=SC2016
task9_campaign() {
  attempt=$(json_get "$state" run.attempt); case $attempt in (1|2) ;; (*) refuse;; esac; suffix="-attempt-$attempt"; binding="$transaction_dir/root-binding$suffix.json"
  if [ "$attempt" = 2 ]; then task9_doc rearm "$transaction_dir/root-rearm-request.json"; task9_root rearm "$transaction_dir/root-rearm-request.json" "$transaction_dir/root-rearm-authorization.json"; task9_doc begin "$binding"; binding_sha=$("$node" -e 'const fs=require("fs"),crypto=require("crypto"),c=v=>Array.isArray(v)?`[${v.map(c)}]`:v&&typeof v==="object"?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${c(v[k])}`)}}`:JSON.stringify(v);process.stdout.write(crypto.createHash("sha256").update(c(JSON.parse(fs.readFileSync(process.argv[1])))).digest("hex"))' "$binding") || refuse; [ "$(json_get "$transaction_dir/root-rearm-authorization.json" bindingSha256)" = "$binding_sha" ] && [ "$(json_get "$transaction_dir/root-rearm-authorization.json" campaignId)" = "$campaign_id" ] && [ "$(json_get "$transaction_dir/root-rearm-authorization.json" priorAttempt)" = 1 ] && [ "$(json_get "$transaction_dir/root-rearm-authorization.json" schemaVersion)" = 1 ] && [ "$(json_get "$transaction_dir/root-rearm-authorization.json" runId)" = "$(json_get "$state" run.id)" ] && [ "$(json_get "$transaction_dir/root-rearm-authorization.json" stateGeneration)" = "$(json_get "$state" generation)" ] || refuse; else task9_doc begin "$binding"; campaign_id=$(json_get "$binding" campaignId); /usr/bin/printf '%s' "$campaign_id" | /usr/bin/grep -Eq '^[a-z0-9][a-z0-9-]{0,62}$' || refuse; fi
  task9_root_started=1; task9_root begin "$binding" "$transaction_dir/root-admission-challenge$suffix.json"; task9_doc admission "$transaction_dir/root-admission$suffix.json"; task9_root admit "$transaction_dir/root-admission$suffix.json" "$transaction_dir/root-hold$suffix.json"; task9_runner_hold
  task9_until list-runner-inventory --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9_doc inventory "$transaction_dir/root-inventory$suffix.json"; task9_root release "$transaction_dir/root-inventory$suffix.json" "$transaction_dir/root-release$suffix.txt"; [ "$(/bin/cat "$transaction_dir/root-release$suffix.txt")" = acknowledged ] || refuse; task9_terminal
}
task9_exact() {
  evidence_directory="/private/tmp/baci-cwv-h0-evidence-$(json_get "$state" sourceAuthorization.transactionId)"; readonly evidence_directory; task9_root_started=0; task9_cleanup_confirmed=0; rerun_pending=0; trap 'task9_cancel; task9_manual; task9_abort' EXIT HUP INT TERM; task9_until list-attestation-runs "$@"; if task9 dispatch-exact-run --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; then :; else phase=$(json_get "$state" phase); [ "$phase" = DISPATCH_INDETERMINATE ] || refuse; fi; task9_until list-attestation-runs --state "$state" --state-sha256 "$state_sha" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256"; task9_campaign; [ "$rerun_pending" = 0 ] || { rerun_pending=0; task9_campaign; }; [ "$rerun_pending" = 0 ] || refuse; task9_root_started=0; trap - EXIT HUP INT TERM
}
task7_op() { operation=$1 probe_id=${2-}; if [ -n "$probe_id" ]; then "$VERIFIER" --policy "$policy" --checksum-file "$transaction_dir/gh-checksums.txt" --archive "$transaction_dir/gh.tar.gz" --receipt "$transaction_dir/gh-receipt.json" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256" --purpose task7-provisioning --exec-gh-operation "$operation" --probe-id "$probe_id"; else "$VERIFIER" --policy "$policy" --checksum-file "$transaction_dir/gh-checksums.txt" --archive "$transaction_dir/gh.tar.gz" --receipt "$transaction_dir/gh-receipt.json" --source-authorization "$source_authorization" --source-authorization-sha256 "$source_authorization_sha256" --purpose task7-provisioning --exec-gh-operation "$operation"; fi; }
task7_record() { probe_id=$1 response="$transaction_dir/probe-$probe_id-ref-response.json" ledger="$transaction_dir/task7-probe-$probe_id.json"; assert_child_file "$response"; [ ! -e "$ledger" ] && [ ! -L "$ledger" ] || refuse; ref=$(json_get "$response" ref); object=$(json_get "$response" object.sha); [ -n "$ref" ] && [ "${#object}" -eq 40 ] || refuse; case $object in (*[!0-9a-f]*|'') refuse;; esac; temporary=$(/usr/bin/mktemp "$transaction_dir/task7-probe-$probe_id.XXXXXX") || refuse; /usr/bin/printf '{"objectSha":"%s","policyFileSha256":"%s","ref":"%s","schemaVersion":1,"sourceAuthorizationSha256":"%s","targetSha":"%s"}' "$object" "$(sha256 "$policy")" "$ref" "$(sha256 "$source_authorization")" "$target" >"$temporary"; /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$ledger" || refuse; }
task7_mutation_intent() { file="$transaction_dir/ruleset-mutation-intent.json"; [ -f "$file" ] && [ ! -L "$file" ] || return 1; assert_child_file "$file"; [ "$(file_mode "$file")" = 400 ] && [ "$(/usr/bin/plutil -extract schemaVersion raw -o - "$file" 2>/dev/null)" = 1 ] && [ "$(/usr/bin/plutil -extract operation raw -o - "$file" 2>/dev/null)" = upsert-rollout-ruleset ] && [ "$(/usr/bin/plutil -extract requestSha256 raw -o - "$file" 2>/dev/null)" = "$(sha256 "$transaction_dir/ruleset-request.json")" ]; }
task7_cleanup() { [ "${task7_armed-0}" = 1 ] && [ "${task7_activated-0}" = 0 ] || return 0; marker="$transaction_dir/ruleset-activated.json"; if [ -f "$marker" ] && [ ! -L "$marker" ]; then assert_child_file "$marker"; id=$(/usr/bin/plutil -extract id raw -o - "$marker" 2>/dev/null || :); case $id in (*[!0-9]*|'') :;; (*) if [ "$(file_mode "$marker")" = 400 ] && [ "$(/usr/bin/plutil -extract requestSha256 raw -o - "$marker" 2>/dev/null || :)" = "$(sha256 "$transaction_dir/ruleset-request.json")" ]; then task7_manual; return; fi;; esac; fi; if task7_mutation_intent; then task7_manual ruleset-mutation-indeterminate; return; fi; for probe_id in 0 1 2; do [ -f "$transaction_dir/probe-$probe_id-ref-response.json" ] && task7_op rollback-owned-probe-ref "$probe_id" >/dev/null 2>&1 || :; done; }
task7_manual() { output="$transaction_dir/task7-manual-reconciliation.json" reason=${1-post-activation-refusal-failed}; [ ! -e "$output" ] && [ ! -L "$output" ] || return 0; temporary=$(/usr/bin/mktemp "$transaction_dir/task7-manual.XXXXXX") || return 0; /usr/bin/printf '{"reason":"%s","schemaVersion":1}' "$reason" >"$temporary"; /bin/chmod 0400 "$temporary"; publish_once "$temporary" "$output" || return 0; }
task7_probes() {
  [ "$#" -eq 8 ] && [ "$1" = --transaction-dir ] && [ "$3" = --policy ] && [ "$5" = --source-authorization ] && [ "$7" = --source-authorization-sha256 ] || refuse; transaction_dir=$2; policy=$4; source_authorization=$6; source_authorization_sha256=$8; assert_transaction "$transaction_dir"
  for file in "$policy" "$source_authorization" "$source_authorization_sha256"; do assert_child_file "$file"; done; verify_source_binding task7-provisioning; target=$(json_get "$policy" authority.implementationBaseSha); [ "${#target}" -eq 40 ] || refuse; case $target in (*[!0-9a-f]*|'') refuse;; esac; task7_armed=1 task7_activated=0; trap 'task7_cleanup' EXIT HUP INT TERM
  for probe_id in 0 1 2; do task7_op create-owned-probe-tag-object "$probe_id" >/dev/null; task7_op create-owned-probe-ref "$probe_id" >/dev/null; task7_record "$probe_id"; done
  for probe_id in 0 1 2; do task7_op read-owned-probe-ref "$probe_id" >/dev/null; done
  task7_op upsert-rollout-ruleset >/dev/null; [ -f "$transaction_dir/ruleset-activated.json" ] && [ ! -L "$transaction_dir/ruleset-activated.json" ] || refuse; task7_activated=1 task7_armed=0
  for probe_id in 0 1 2; do for operation in assert-owned-probe-duplicate-create assert-owned-probe-update assert-owned-probe-force-update assert-owned-probe-delete; do task7_op "$operation" "$probe_id" || { task7_manual; refuse; }; done; done
  trap - EXIT HUP INT TERM
}
[ "$#" -gt 0 ] || refuse
case $1 in
  (--prepare-cli) shift; prepare cli "$@";; (--prepare-task9-cli) shift; prepare task9-cli "$@";; (--prepare-task9-bootstrap-node) shift; prepare_task9_bootstrap_node "$@";; (--compose-task9-bundle) shift; compose_task9_bundle "$@";; (--initialize-task9-state) shift; initialize_task9 "$@";; (--bootstrap-task9) shift; bootstrap_task9 "$@";;
  (--run-task9-exact) shift; task9_exact "$@";; (--run-task7-probes) shift; task7_probes "$@";; (--task9-operation) shift; [ "$#" -gt 0 ] || refuse; operation=$1; shift; task9 "$operation" "$@";; (*) refuse;;
esac
