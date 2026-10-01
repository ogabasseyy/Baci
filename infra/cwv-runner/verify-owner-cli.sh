#!/bin/sh
set -eu
umask 077
readonly API_VERSION=2026-03-10 REPOSITORY=ogabasseyy/Baci
readonly TASK7_OPERATIONS='["set-auditor-private-key","set-auditor-app-id","set-auditor-client-id","set-auditor-installation-id","read-auditor-app-registration","read-repository-retention","read-rollout-ruleset","create-owned-probe-tag-object","create-owned-probe-ref","read-owned-probe-ref","rollback-owned-probe-ref","upsert-rollout-ruleset","assert-owned-probe-duplicate-create","assert-owned-probe-update","assert-owned-probe-force-update","assert-owned-probe-delete"]'
readonly TASK9_OPERATIONS='["list-attestation-runs","dispatch-exact-run","read-exact-run","cancel-exact-run","read-failed-job-evidence","rerun-failed-exact-run","list-runner-inventory","read-exact-job","list-exact-artifacts","download-exact-artifact"]'
refuse() { /usr/bin/printf '%s\n' 'owner CLI verification refused' >&2; exit 65; }
sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk 'NR==1 {print $1}'; }
json_get() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null || refuse; }
json_array() { /usr/bin/plutil -extract "$2" json -o - "$1" 2>/dev/null || refuse; }
xml_count() { /usr/bin/plutil -extract "$2" xml1 -o - "$1" 2>/dev/null | /usr/bin/xmllint --xpath "$3" - 2>/dev/null || refuse; }
is_sha256() { case $1 in (*[!0-9a-f]*|'') return 1;; esac; [ "${#1}" -eq 64 ]; }; is_sha1() { case $1 in (*[!0-9a-f]*|'') return 1;; esac; [ "${#1}" -eq 40 ]; }
is_purpose() { [ "$1" = task7-provisioning ] || [ "$1" = task9-exact-run ]; }
file_mode() { /usr/bin/stat -f '%Lp' "$1" 2>/dev/null || refuse; }
file_owner() { /usr/bin/stat -f '%Su' "$1" 2>/dev/null || refuse; }
current_owner() { /usr/bin/id -un; }
assert_parent() { root=$1; case "$root" in (/private/tmp/baci-cwv-*) ;; (*) refuse;; esac; [ -d "$root" ] && [ ! -L "$root" ] || refuse
  [ "$(file_mode "$root")" = 700 ] && [ "$(file_owner "$root")" = "$(current_owner)" ] || refuse; }
assert_child() {
  root=$1 path=$2
  case "$path" in ("$root"/*) ;; (*) refuse;; esac; case "$path" in (*'/../'*|*'/./'*|*'//'*) refuse;; esac
  [ -f "$path" ] && [ ! -L "$path" ] && [ "$(file_owner "$path")" = "$(current_owner)" ] || refuse
  parent=$(/usr/bin/dirname -- "$path")
  while [ "$parent" != "$root" ]; do
    case "$parent" in ("$root"/*) ;; (*) refuse;; esac; [ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(file_owner "$parent")" = "$(current_owner)" ] || refuse
    parent=$(/usr/bin/dirname -- "$parent")
  done
}
write_atomic() ( destination=$1 bytes=$2 mode=$3; [ ! -e "$destination" ] && [ ! -L "$destination" ] || refuse
  temporary=$(/usr/bin/mktemp "${destination}.tmp.XXXXXX") || refuse; trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM
  /usr/bin/printf '%s' "$bytes" >"$temporary"; /bin/chmod "$mode" "$temporary"; /bin/sync; /bin/ln "$temporary" "$destination" || refuse
  /bin/rm -f -- "$temporary" || refuse; /bin/sync; trap - EXIT HUP INT TERM
)
write_digest() ( destination=$1 value=$2; [ ! -e "$destination" ] && [ ! -L "$destination" ] || refuse
  temporary=$(/usr/bin/mktemp "${destination}.tmp.XXXXXX") || refuse; trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM
  /usr/bin/printf '%s\n' "$value" >"$temporary"; /bin/chmod 0400 "$temporary"; /bin/sync
  /bin/ln "$temporary" "$destination" || refuse; /bin/rm -f -- "$temporary" || refuse; /bin/sync; trap - EXIT HUP INT TERM
)
operation_set() { case $1 in (task7-provisioning) /usr/bin/printf '%s' "$TASK7_OPERATIONS";; (task9-exact-run) /usr/bin/printf '%s' "$TASK9_OPERATIONS";; (*) refuse;; esac; }
ruleset_body() {
  name=$(json_get "$policy" ruleset.name)
  target=$(json_get "$policy" ruleset.target)
  enforcement=$(json_get "$policy" ruleset.enforcement)
  include_source=$(json_get "$policy" ruleset.tagIncludes)
  excludes=$(json_array "$policy" ruleset.tagExcludes)
  bypasses=$(json_array "$policy" ruleset.bypassActors)
  [ "$name" = ogabassey-rollout-progress-immutable ] || refuse
  [ "$target" = tag ] && [ "$enforcement" = active ] || refuse
  [ "$include_source" = 'refs/tags/ogabassey-rollout-claim/*|refs/tags/ogabassey-rollout-progress/**/*|refs/tags/ogabassey-semantic-admission/*' ] || refuse
  includes='["refs\/tags\/ogabassey-rollout-claim\/*","refs\/tags\/ogabassey-rollout-progress\/**\/*","refs\/tags\/ogabassey-semantic-admission\/*"]'
  [ "$excludes" = '[]' ] && [ "$bypasses" = '[]' ] && [ "$(json_get "$policy" ruleset.rules.0)" = update ] && [ "$(json_get "$policy" ruleset.rules.1)" = deletion ] || refuse
  /usr/bin/plutil -extract ruleset.rules.2 raw -o - "$policy" >/dev/null 2>&1 && refuse
  /usr/bin/printf '{"name":"%s","target":"%s","enforcement":"%s","bypass_actors":%s,"conditions":{"ref_name":{"include":%s,"exclude":%s}},"rules":[{"type":"update"},{"type":"deletion"}]}' "$name" "$target" "$enforcement" "$bypasses" "$includes" "$excludes"; }
ruleset_readback_body() {
  response=$1; name=$(json_get "$response" name); target=$(json_get "$response" target); enforcement=$(json_get "$response" enforcement); includes=$(json_array "$response" conditions.ref_name.include); excludes=$(json_array "$response" conditions.ref_name.exclude); bypasses=$(json_array "$response" bypass_actors)
  [ "$(xml_count "$response" conditions 'count(/plist/dict/key)')" = 1 ] && [ "$(xml_count "$response" conditions 'count(/plist/dict/key[text()="ref_name"])')" = 1 ] && [ "$(xml_count "$response" conditions.ref_name 'count(/plist/dict/key)')" = 2 ] && [ "$(xml_count "$response" conditions.ref_name 'count(/plist/dict/key[text()="include"])')" = 1 ] && [ "$(xml_count "$response" conditions.ref_name 'count(/plist/dict/key[text()="exclude"])')" = 1 ] && [ "$(xml_count "$response" rules.0 'count(/plist/dict/key)')" = 1 ] && [ "$(xml_count "$response" rules.0 'count(/plist/dict/key[text()="type"])')" = 1 ] && [ "$(xml_count "$response" rules.1 'count(/plist/dict/key)')" = 1 ] && [ "$(xml_count "$response" rules.1 'count(/plist/dict/key[text()="type"])')" = 1 ] && [ "$(json_get "$response" rules.0.type)" = update ] && [ "$(json_get "$response" rules.1.type)" = deletion ] || refuse; /usr/bin/plutil -extract rules.2 raw -o - "$response" >/dev/null 2>&1 && refuse
  /usr/bin/printf '{"name":"%s","target":"%s","enforcement":"%s","bypass_actors":%s,"conditions":{"ref_name":{"include":%s,"exclude":%s}},"rules":[{"type":"update"},{"type":"deletion"}]}' "$name" "$target" "$enforcement" "$bypasses" "$includes" "$excludes"
}
ruleset_reconciliation() { phase=$1 published=$2 unpublished=$3; write_atomic "$root/ruleset-variable-$phase.json" "{\"id\":$actual,\"publishedVariables\":$published,\"requestSha256\":\"$request_sha\",\"schemaVersion\":1,\"unpublishedVariables\":$unpublished}" 0400; }
ruleset_reconciliation_closed() { for phase in publication-intent id-published sha-published publication-complete; do file="$root/ruleset-variable-$phase.json"; assert_child "$root" "$file"; [ "$(file_mode "$file")" = 400 ] || refuse; done
  [ "$(/bin/cat "$root/ruleset-variable-publication-intent.json")" = "{\"id\":$id,\"publishedVariables\":[],\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\",\"schemaVersion\":1,\"unpublishedVariables\":[\"H0_RUNNER_RULESET_ID\",\"H0_RUNNER_RULESET_SHA256\"]}" ] && [ "$(/bin/cat "$root/ruleset-variable-id-published.json")" = "{\"id\":$id,\"publishedVariables\":[\"H0_RUNNER_RULESET_ID\"],\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\",\"schemaVersion\":1,\"unpublishedVariables\":[\"H0_RUNNER_RULESET_SHA256\"]}" ] && [ "$(/bin/cat "$root/ruleset-variable-sha-published.json")" = "{\"id\":$id,\"publishedVariables\":[\"H0_RUNNER_RULESET_ID\",\"H0_RUNNER_RULESET_SHA256\"],\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\",\"schemaVersion\":1,\"unpublishedVariables\":[]}" ] && [ "$(/bin/cat "$root/ruleset-variable-publication-complete.json")" = "{\"id\":$id,\"publishedVariables\":[\"H0_RUNNER_RULESET_ID\",\"H0_RUNNER_RULESET_SHA256\"],\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\",\"schemaVersion\":1,\"unpublishedVariables\":[]}" ] || refuse; }
probe_sha() { sha=$(json_get "$policy" authority.implementationBaseSha); is_sha1 "$sha" || refuse; /usr/bin/printf '%s' "$sha"; }
probe_ref() { case $probe_id in (0) /usr/bin/printf '%s' refs/tags/ogabassey-rollout-claim/h0-runner-ruleset-probe-v1;; (1) /usr/bin/printf '%s' refs/tags/ogabassey-rollout-progress/h0-runner-ruleset-probe-v1/start;; (2) /usr/bin/printf '%s' refs/tags/ogabassey-semantic-admission/h0-runner-ruleset-probe-v1;; (*) refuse;; esac; }
probe_files() { stem="$root/probe-$probe_id"; tag_request="$stem-tag-request.json"; tag_response="$stem-tag-response.json"; ref_request="$stem-ref-request.json"; ref_response="$stem-ref-response.json"; ledger="$root/task7-probe-$probe_id.json"; }
verify_probe_receipt() { probe_files; assert_child "$root" "$ref_response"; [ "$(file_mode "$ref_response")" = 400 ] || refuse; ref=$(probe_ref); [ "$(json_get "$ref_response" ref)" = "$ref" ] || refuse; object=$(json_get "$ref_response" object.sha); is_sha1 "$object" || refuse; }
verify_probe_binding() { verify_probe_receipt; assert_child "$root" "$ledger"; [ "$(file_mode "$ledger")" = 400 ] || refuse
  [ "$(json_get "$ledger" schemaVersion)" = 1 ] && [ "$(json_get "$ledger" policyFileSha256)" = "$(sha256 "$policy")" ] && [ "$(json_get "$ledger" sourceAuthorizationSha256)" = "$(sha256 "$source_receipt")" ] && [ "$(json_get "$ledger" ref)" = "$ref" ] && [ "$(json_get "$ledger" targetSha)" = "$(probe_sha)" ] && [ "$(json_get "$ledger" objectSha)" = "$object" ] || refuse; }
assert_owner_input() {
  file=$1 kind=$2; assert_child "$root" "$file"
  case $kind in
    (numeric) if [ "$(file_mode "$file")" = 400 ] && /usr/bin/awk 'NR == 1 && /^[1-9][0-9]*$/ {valid=1} END {exit !(NR == 1 && valid)}' "$file"; then :; else refuse; fi;;
    (client_id) if [ "$(file_mode "$file")" = 400 ] && /usr/bin/awk 'NR == 1 && length($0) <= 128 && ($0 ~ /^Iv1(\.)?[A-Za-z0-9]+$/ || $0 ~ /^Iv[A-Za-z0-9]{18}$/) && $0 !~ /^(github_pat_|gh[pousr]_)/ {valid=1} END {exit !(NR == 1 && valid)}' "$file"; then :; else refuse; fi;;
    (pem) if [ "$(file_mode "$file")" = 600 ] && /usr/bin/awk 'NR == 1 && $0 == "-----BEGIN PRIVATE KEY-----" {begin=1} $0 == "-----END PRIVATE KEY-----" {end=NR} END {exit !(begin && end == NR)}' "$file"; then :; else refuse; fi;;
    (*) refuse;;
  esac
}
write_request() {
  path=$1 bytes=$2
  write_atomic "$path" "$bytes" 0400
  assert_child "$root" "$path"
}
task9_source_hash() { wanted=$1 index=0 found=''
  while candidate=$(/usr/bin/plutil -extract "sourceFiles.$index.path" raw -o - "$source_receipt" 2>/dev/null); do value=$(json_get "$source_receipt" "sourceFiles.$index.sha256"); is_sha256 "$value" || refuse; [ "$candidate" = "$wanted" ] || { index=$((index + 1)); continue; }; [ -z "$found" ] || refuse; found=$value; index=$((index + 1)); done
  [ -n "$found" ] || refuse; /usr/bin/printf '%s' "$found"
}
existing_ruleset_id() { page=1 matches=0 id='' empty=false
  while [ "$page" -le 100 ]; do listing="$root/ruleset-list-$page.json"; [ ! -e "$listing" ] && [ ! -L "$listing" ] || refuse
    "$gh" api --method GET -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/rulesets?per_page=100&page=$page" >"$listing" || refuse; /bin/chmod 0400 "$listing"; assert_child "$root" "$listing"; case "$(/bin/cat "$listing")" in (\[*\]) :;; (*) refuse;; esac; index=0
    while /usr/bin/plutil -extract "$index" json -o - "$listing" >/dev/null 2>&1; do name=$(json_get "$listing" "$index.name"); if [ "$name" = "$(json_get "$policy" ruleset.name)" ]; then candidate=$(json_get "$listing" "$index.id"); case $candidate in (*[!0-9]*|'') refuse;; esac; matches=$((matches + 1)); id=$candidate; fi; index=$((index + 1)); done
    [ "$index" -eq 0 ] && { empty=true; break; }; page=$((page + 1))
  done
  [ "$empty" = true ] && [ "$matches" -le 1 ] || refuse; /usr/bin/printf '%s' "$id"
}
create_probe_tag_object() {
  probe_files; ref=$(probe_ref); target=$(probe_sha); [ ! -e "$tag_response" ] && [ ! -L "$tag_response" ] || refuse
  write_request "$tag_request" "{\"tag\":\"${ref#refs/tags/}\",\"message\":\"H0 runner ruleset probe\",\"object\":\"$target\",\"type\":\"commit\"}"
  "$gh" api --method POST -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/tags" --input "$tag_request" >"$tag_response" || refuse
  /bin/chmod 0400 "$tag_response"; assert_child "$root" "$tag_response"; is_sha1 "$(json_get "$tag_response" sha)" || refuse; /bin/cat "$tag_response"
}
create_probe_ref() {
  probe_files; assert_child "$root" "$tag_response"; object=$(json_get "$tag_response" sha); is_sha1 "$object" || refuse
  [ ! -e "$ref_response" ] && [ ! -L "$ref_response" ] || refuse; write_request "$ref_request" "{\"ref\":\"$(probe_ref)\",\"sha\":\"$object\"}"
  "$gh" api --method POST -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/refs" --input "$ref_request" >"$ref_response" || refuse
  /bin/chmod 0400 "$ref_response"; verify_probe_receipt; [ "$(json_get "$ref_response" object.sha)" = "$object" ] || refuse; /bin/cat "$ref_response"
}
ruleset_active() {
  verify_probe_binding; marker="$root/ruleset-activated.json"; assert_child "$root" "$marker"; [ "$(file_mode "$marker")" = 400 ] || refuse; id=$(json_get "$marker" id); case $id in (*[!0-9]*|'') refuse;; esac; [ "$(json_get "$marker" requestSha256)" = "$(sha256 "$root/ruleset-request.json")" ] || refuse; ruleset_reconciliation_closed
}
expect_refusal() { stem=$1 docs=$2 expected_kind=$3; shift 3; wire="$stem.wire"; body="$stem.body.json"; error="$stem.stderr"; for file in "$wire" "$body" "$error"; do [ ! -e "$file" ] && [ ! -L "$file" ] || refuse; done
  if "$@" >"$wire" 2>"$error"; then refuse; else result=$?; fi; [ "$result" -eq 1 ] || refuse; /bin/chmod 0400 "$wire" "$error"; assert_child "$root" "$wire"; assert_child "$root" "$error"
  /usr/bin/awk 'BEGIN {count=0} /^HTTP\/[0-9.]+ [0-9][0-9][0-9]/ {count++; code=$2} END {exit !(count==1 && code==422)}' "$wire" || refuse; /usr/bin/awk 'BEGIN {body=0} {line=$0; sub(/\r$/, "", line); if (body) {print; next} if (line=="") body=1} END {if (!body) exit 1}' "$wire" >"$body" || refuse; /bin/chmod 0400 "$body"; assert_child "$root" "$body"
  message=$(json_get "$body" message); case $expected_kind in (duplicate) case $message in ('Reference already exists'|'Repository rule violations found') :;; (*) refuse;; esac;; (update) [ "$message" = 'Repository rule violations found' ] || [ "$message" = "$(/usr/bin/printf 'Repository rule violations found\n\nCannot update this protected ref.\n\n')" ] || refuse;; (delete) [ "$message" = 'Repository rule violations found' ] || [ "$message" = "$(/usr/bin/printf 'Repository rule violations found\n\nCannot delete this protected ref.\n\n')" ] || [ "$message" = "$(/usr/bin/printf 'Repository rule violations found\n\nCannot delete this tag\n\n')" ] || refuse;; (*) refuse;; esac; if [ "$(json_get "$body" documentation_url)" = "$docs" ] && /usr/bin/plutil -extract status xml1 -o - "$body" 2>/dev/null | /usr/bin/grep -q '<string>422</string>'; then :; else refuse; fi
}
verify_source_receipt() (
  receipt=$1 digest_file=$2 purpose=$3 policy=$4 dispatcher=$5 verifier=$6
  root=$(/usr/bin/dirname -- "$receipt")
  assert_parent "$root"
  for file in "$receipt" "$digest_file" "$policy" "$dispatcher" "$verifier"; do assert_child "$root" "$file"; done
  is_purpose "$purpose" || refuse
  stored_digest=$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$digest_file") || refuse
  is_sha256 "$stored_digest" && [ "$stored_digest" = "$(sha256 "$receipt")" ] || refuse
  [ "$(json_get "$receipt" purpose)" = "$purpose" ] || refuse
  [ "$(json_get "$receipt" schemaVersion)" = 1 ] || refuse
  [ "$(json_get "$receipt" policyFileSha256)" = "$(sha256 "$policy")" ] || refuse
  [ "$(json_array "$receipt" operationSet)" = "$(operation_set "$purpose")" ] || refuse
  [ "$(json_get "$receipt" operationSetDigest)" = "$(operation_set "$purpose" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')" ] || refuse
  case $purpose in
    (task7-provisioning)
      [ "$(json_get "$receipt" sourceHashes.dispatcherSha256)" = "$(sha256 "$dispatcher")" ] && [ "$(json_get "$receipt" sourceHashes.verifierSha256)" = "$(sha256 "$verifier")" ] || refuse;;
    (task9-exact-run)
      [ "$(task9_source_hash infra/cwv-runner/owner-dispatch.sh)" = "$(sha256 "$dispatcher")" ] && [ "$(task9_source_hash infra/cwv-runner/verify-owner-cli.sh)" = "$(sha256 "$verifier")" ] || refuse
      for key in provenance.manifestSha256 provenance.nodeProvenanceSha256 provenance.runtimeSha256 provenance.sourceArchiveSha256 sourceBinding.exactRun.admissionId; do is_sha256 "$(json_get "$receipt" "$key")" || refuse; done
      [ "$(json_get "$receipt" sourceBinding.repository.id)" = 1100488586 ] && [ "$(json_get "$receipt" sourceBinding.repository.name)" = ogabasseyy/Baci ] || refuse
      ref=$(json_get "$receipt" sourceBinding.ref); case $ref in (refs/pull/*/merge) pr=${ref#refs/pull/}; pr=${pr%/merge};; (*) refuse;; esac
      case $pr in (*[!0-9]*|'') refuse;; esac
      [ "$pr" = "$(json_get "$receipt" sourceBinding.pullRequest.number)" ] && [ -n "$(json_get "$receipt" sourceBinding.pullRequest.headRef)" ] || refuse
      [ "$(json_get "$receipt" sourceBinding.base.ref)" = refs/heads/main ] || refuse
      [ "$(json_get "$receipt" sourceBinding.exactRun.workflow.path)" = .github/workflows/cwv-runner-attestation.yml ] && [ "$(json_get "$receipt" sourceBinding.exactRun.workflow.ref)" = refs/heads/main ] || refuse
      for key in sourceBinding.base.sha sourceBinding.reviewedSha sourceBinding.mergeSha sourceBinding.deploymentSha; do is_sha1 "$(json_get "$receipt" "$key")" || refuse; done
      ;;
    (*) refuse;;
  esac
)
verify_preflight_manifest() {
  manifest=$1 manifest_sha=$2 policy=$3
  canonical=$(/usr/bin/jq -cS 'def exact($wanted):(keys|sort)==($wanted|sort); def hex($size):type=="string" and length==$size and test("^[0-9a-f]+$"); def positive_integer:type=="number" and .>0 and floor==.; def archive_entry:exact(["blobSha256","mode","path"]) and (.blobSha256|hex(64)) and (.mode=="100644" or .mode=="100755") and (.path|type=="string" and startswith("infra/cwv-runner/")); def changed_entry:((.status=="D" and exact(["absent","path","status"]) and .absent==true) or ((.status=="A" or .status=="M") and exact(["blobSha256","mode","path","status"]) and (.blobSha256|hex(64)) and (.mode=="100644" or .mode=="100755"))) and (.path|type=="string" and length>0); select(exact(["authority","baseSha","entries","policyCanonicalSha256","policyFileSha256","prNumber","reviewedHeadSha","schemaVersion","sourceArchive"]) and .schemaVersion=="preflight-v1" and (.prNumber|positive_integer) and (.reviewedHeadSha|hex(40)) and (.baseSha|hex(40)) and (.policyCanonicalSha256|hex(64)) and (.policyFileSha256|hex(64)) and (.authority|exact(["deploymentMarker","deploymentRunAttempt","deploymentRunId","implementationBaseSha","normativeContractPath","normativeContractSha256"]) and (.deploymentMarker|type=="string" and length>0) and (.deploymentRunAttempt|positive_integer) and (.deploymentRunId|positive_integer) and (.implementationBaseSha|hex(40)) and (.normativeContractPath|type=="string" and length>0) and (.normativeContractSha256|hex(64))) and (.entries|type=="array" and all(.[];changed_entry)) and (.sourceArchive|exact(["entries","prefix"]) and .prefix=="infra/cwv-runner/" and (.entries|type=="array" and length>0 and all(.[];archive_entry))))' "$manifest" 2>/dev/null) || refuse
  [ "$(/usr/bin/printf '%s' "$canonical" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')" = "$manifest_sha" ] || refuse
  policy_canonical=$(/usr/bin/jq -cS . "$policy" 2>/dev/null) || refuse; [ "$(/usr/bin/printf '%s' "$policy_canonical" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')" = "$(json_get "$manifest" policyCanonicalSha256)" ] || refuse
  [ "$(/usr/bin/jq -cS .authority "$manifest" 2>/dev/null)" = "$(/usr/bin/jq -cS .authority "$policy" 2>/dev/null)" ] || refuse
}
verify_source() {
  manifest='' manifest_sha='' policy='' dispatcher='' verifier='' purpose='' output='' output_digest=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in
      (--manifest) manifest=$value;; (--manifest-sha256) manifest_sha=$value;;
      (--policy) policy=$value;; (--dispatcher) dispatcher=$value;;
      (--verifier) verifier=$value;; (--purpose) purpose=$value;;
      (--output-receipt) output=$value;; (--output-digest) output_digest=$value;;
      (*) refuse;;
    esac
  done
  [ -n "$manifest$manifest_sha$policy$dispatcher$verifier$purpose$output$output_digest" ] || refuse
  if ! is_sha256 "$manifest_sha" || ! is_purpose "$purpose"; then refuse; fi
  [ "$purpose" = task7-provisioning ] || refuse
  root=$(/usr/bin/dirname -- "$output"); assert_parent "$root"
  [ "$output_digest" = "$root/source-authorization.sha256" ] && [ "$output" = "$root/source-authorization.json" ] || refuse
  for file in "$manifest" "$policy" "$dispatcher" "$verifier"; do assert_child "$root" "$file"; done
  [ "$(sha256 "$manifest")" = "$manifest_sha" ] || refuse
  verify_preflight_manifest "$manifest" "$manifest_sha" "$policy"
  policy_sha=$(sha256 "$policy")
  [ "$(json_get "$manifest" policyFileSha256)" = "$policy_sha" ] || refuse
  expected_paths='infra/cwv-runner/owner-dispatch.sh infra/cwv-runner/policy.json infra/cwv-runner/verify-owner-cli.sh'; archive_count=$(xml_count "$manifest" sourceArchive.entries 'count(/plist/array/*)'); case $archive_count in (*[!0-9]*|'') refuse;; esac; [ "$archive_count" -gt 0 ] || refuse
  for expected_path in $expected_paths; do
    case $expected_path in (*/owner-dispatch.sh) expected_mode=100755 source=$dispatcher;; (*/policy.json) expected_mode=100644 source=$policy;; (*/verify-owner-cli.sh) expected_mode=100755 source=$verifier;; (*) refuse;; esac
    index=0 matches=0
    while [ "$index" -lt "$archive_count" ]; do candidate=$(json_get "$manifest" "sourceArchive.entries.$index.path")
      if [ "$candidate" = "$expected_path" ]; then matches=$((matches + 1)); [ "$(json_get "$manifest" "sourceArchive.entries.$index.mode")" = "$expected_mode" ] && [ "$(json_get "$manifest" "sourceArchive.entries.$index.blobSha256")" = "$(sha256 "$source")" ] || refuse; fi
      index=$((index + 1))
    done
    [ "$matches" -eq 1 ] || refuse
  done
  tx=$(/usr/bin/basename -- "$root"); operations=$(operation_set "$purpose")
  operations_sha=$(printf '%s' "$operations" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')
  receipt=$(/usr/bin/printf '{"generation":0,"operationSet":%s,"operationSetDigest":"%s","policyFileSha256":"%s","provenance":{"manifestSha256":"%s","nodeProvenanceSha256":null,"runtimeSha256":null,"sourceArchiveSha256":null},"purpose":"%s","schemaVersion":1,"sourceBinding":null,"sourceHashes":{"bootstrapSha256":null,"dispatcherSha256":"%s","transportSha256":null,"verifierSha256":"%s"},"transactionId":"%s"}' "$operations" "$operations_sha" "$policy_sha" "$manifest_sha" "$purpose" "$(sha256 "$dispatcher")" "$(sha256 "$verifier")" "$tx")
  write_atomic "$output" "$receipt" 0400
  write_digest "$output_digest" "$(sha256 "$output")"
}
prepare_task9_bootstrap_node() {
  root='' policy='' reviewed_policy_sha=''; while [ "$#" -gt 0 ]; do option=$1; shift; [ "$#" -gt 0 ] || refuse; value=$1; shift; case $option in (--root) root=$value;; (--policy) policy=$value;; (--reviewed-policy-sha256) reviewed_policy_sha=$value;; (*) refuse;; esac; done
  if [ -z "$root$policy$reviewed_policy_sha" ] || ! is_sha256 "$reviewed_policy_sha"; then refuse; fi; assert_parent "$root"; [ "$policy" = "$root/policy.json" ] && [ "$(sha256 "$policy")" = "$reviewed_policy_sha" ] || refuse
  archive="$root/node.tar.xz"; checksums="$root/node-shasums.txt"; signature="$root/node-shasums.sig"; keyring="$root/node-keyring.kbx"; for file in "$policy" "$archive" "$checksums" "$signature" "$keyring"; do assert_child "$root" "$file"; [ "$(file_mode "$file")" = 400 ] || refuse; done
  [ "$(json_get "$policy" supplyChain.node.version)" = 24.18.0 ] && [ "$(sha256 "$archive")" = "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" ] && [ "$(sha256 "$checksums")" = "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" ] && [ "$(sha256 "$signature")" = "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" ] && [ "$(sha256 "$keyring")" = "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" ] || refuse
  [ -x /usr/local/bin/gpgv ] || refuse; [ -f /usr/local/bin/gpgv ] && [ ! -L /usr/local/bin/gpgv ] && [ "$(file_owner /usr/local/bin/gpgv)" = root ] || refuse; gpgv_mode=$(file_mode /usr/local/bin/gpgv); case $gpgv_mode in (555|755) :;; (*) refuse;; esac; /usr/local/bin/gpgv --keyring "$keyring" "$signature" "$checksums" >/dev/null 2>&1 || refuse
  archive_sha=$(sha256 "$archive"); name='node-v24.18.0-darwin-arm64.tar.xz'; rows=$(/usr/bin/awk -v hash="$archive_sha" -v name="$name" '$1 == hash && $2 == name {count++} END {print count+0}' "$checksums"); [ "$rows" -eq 1 ] || refuse
  stage=$(/usr/bin/mktemp -d "$root/node-stage.XXXXXX") || refuse; trap '/bin/rm -rf -- "$stage"' EXIT HUP INT TERM; /usr/bin/tar -tf "$archive" | /usr/bin/awk 'BEGIN {root="node-v24.18.0-darwin-arm64/"} /^[\/]/ || /(^|\/)\.\.?($|\/)/ || index($0,root)!=1 {exit 1} {count++} END {if(count==0) exit 1}' || refuse; /usr/bin/tar -xJf "$archive" -C "$stage" || refuse
  binary="$stage/node-v24.18.0-darwin-arm64/bin/node"; [ -f "$binary" ] && [ ! -L "$binary" ] && [ "$($binary --version 2>/dev/null)" = v24.18.0 ] || refuse; [ ! -e "$root/prepared-node" ] && [ ! -L "$root/prepared-node" ] || refuse; /bin/mkdir -m 0700 "$root/prepared-node"; /bin/cp -p -- "$binary" "$root/prepared-node/node"; /bin/chmod 0500 "$root/prepared-node/node"
  provenance=$(/usr/bin/printf '{"archiveSha256":"%s","artifact":"node","checksumSha256":"%s","executableSha256":"%s","keyringSha256":"%s","schemaVersion":1,"sha256":"%s","signatureSha256":"%s","version":"24.18.0"}' "$(sha256 "$archive")" "$(sha256 "$checksums")" "$(sha256 "$root/prepared-node/node")" "$(sha256 "$keyring")" "$(sha256 "$root/prepared-node/node")" "$(sha256 "$signature")"); write_atomic "$root/prepared-node/node-provenance.json" "$provenance" 0400; /bin/rm -rf -- "$stage"; trap - EXIT HUP INT TERM; /bin/sync
}
parse_common() {
  policy='' checksum_file='' archive='' receipt='' source_receipt='' source_digest='' purpose='' operation='' mode='' probe_id=''
  while [ "$#" -gt 0 ]; do
    option=$1; shift
    case $option in
      (--verify-only) mode=verify; continue;;
      (--emit-task9-token) mode=token; continue;;
    esac
    [ "$#" -gt 0 ] || refuse; value=$1; shift
    case $option in
      (--policy) policy=$value;; (--checksum-file) checksum_file=$value;; (--archive) archive=$value;;
      (--receipt) receipt=$value;; (--source-authorization) source_receipt=$value;;
      (--source-authorization-sha256) source_digest=$value;; (--purpose) purpose=$value;;
      (--exec-gh-operation) mode='exec'; operation=$value;; (--probe-id) probe_id=$value;; (*) refuse;;
    esac
  done
  [ -n "$policy$checksum_file$archive$receipt$source_receipt$source_digest$purpose$mode" ] || refuse
  case "$mode:$operation" in
    (exec:create-owned-probe-tag-object|exec:create-owned-probe-ref|exec:read-owned-probe-ref|exec:rollback-owned-probe-ref|exec:assert-owned-probe-duplicate-create|exec:assert-owned-probe-update|exec:assert-owned-probe-force-update|exec:assert-owned-probe-delete) case $probe_id in (0|1|2) :;; (*) refuse;; esac;;
    (exec:*) [ -z "$probe_id" ] || refuse;; (*) [ -z "$probe_id" ] || refuse;;
  esac
}
verify_cli() {
  root=$(/usr/bin/dirname -- "$receipt"); assert_parent "$root"
  [ "$checksum_file" = "$root/gh-checksums.txt" ] && [ "$archive" = "$root/gh.tar.gz" ] && [ "$receipt" = "$root/gh-receipt.json" ] || refuse
  case $purpose in
    (task7-provisioning) source_root=$root;;
    (task9-exact-run) source_root="$root/authorized-source/infra/cwv-runner";;
    (*) refuse;;
  esac
  dispatcher="$source_root/owner-dispatch.sh"; verifier="$source_root/verify-owner-cli.sh"; binary="$root/tools/gh/bin/gh"
  verify_source_receipt "$source_receipt" "$source_digest" "$purpose" "$policy" "$dispatcher" "$verifier"
  for file in "$checksum_file" "$archive" "$binary"; do assert_child "$root" "$file"; done
  owner_cli_version=$(json_get "$policy" supplyChainProvenance.ownerCli.version)
  [ "$owner_cli_version" = 2.93.0 ] || refuse
  [ "$(sha256 "$checksum_file")" = "$(json_get "$policy" supplyChainProvenance.ownerCli.checksumsSha256)" ] || refuse
  archive_sha=$(sha256 "$archive")
  [ "$archive_sha" = "$(json_get "$policy" supplyChainProvenance.ownerCli.archiveSha256)" ] || refuse
  rows=$(/usr/bin/awk -v hash="$archive_sha" '$1 == hash && $2 == "gh_2.93.0_macOS_arm64.zip" {count++} END {print count+0}' "$checksum_file")
  [ "$rows" -eq 1 ] || refuse
  [ "$(file_mode "$binary")" = 500 ] || refuse
  binary_sha=$(sha256 "$binary")
  [ "$binary_sha" = "$(json_get "$policy" supplyChainProvenance.ownerCli.binarySha256)" ] || refuse
  version_bytes=$("$binary" --version 2>/dev/null) || refuse
  /usr/bin/printf '%s\n' "$version_bytes" | /usr/bin/awk -v version="$owner_cli_version" 'NR==1 {if ($0 !~ "^gh version " version " ") exit 1} NR==2 {if ($0 != "https://github.com/cli/cli/releases/tag/v" version) exit 1} END {if (NR != 2) exit 1}' || refuse
  source_sha=$(sha256 "$source_receipt"); inode=$(/usr/bin/stat -f '%i' "$binary")
  expected=$(/usr/bin/printf '{"archiveSha256":"%s","binary":{"inode":%s,"mode":500,"path":"tools/gh/bin/gh","sha256":"%s"},"checksumSha256":"%s","purpose":"%s","schemaVersion":1,"sourceAuthorizationSha256":"%s","version":"%s","versionBytesSha256":"%s"}' "$archive_sha" "$inode" "$binary_sha" "$(sha256 "$checksum_file")" "$purpose" "$source_sha" "$owner_cli_version" "$(/usr/bin/printf '%s\n' "$version_bytes" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')")
  if [ ! -e "$receipt" ]; then write_atomic "$receipt" "$expected" 0400; write_digest "$root/gh-receipt.sha256" "$(sha256 "$receipt")"; fi
  assert_child "$root" "$receipt"; [ "$(/bin/cat "$receipt")" = "$expected" ] || refuse
}
app_jwt() { key="$root/private-key.pem"; id_file="$root/auditor-app-id"; assert_owner_input "$key" pem; assert_owner_input "$id_file" numeric; app_id=$(/bin/cat "$id_file"); now=$(/bin/date +%s); header=$(/usr/bin/printf '%s' '{"alg":"RS256","typ":"JWT"}' | /usr/bin/openssl base64 -A | /usr/bin/tr '+/' '-_' | /usr/bin/tr -d '='); payload=$(/usr/bin/printf '{"iat":%s,"exp":%s,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$app_id" | /usr/bin/openssl base64 -A | /usr/bin/tr '+/' '-_' | /usr/bin/tr -d '='); signature=$(/usr/bin/printf '%s.%s' "$header" "$payload" | /usr/bin/openssl dgst -sha256 -sign "$key" | /usr/bin/openssl base64 -A | /usr/bin/tr '+/' '-_' | /usr/bin/tr -d '='); for value in "$header" "$payload" "$signature"; do case $value in (*[!A-Za-z0-9_-]*|'') refuse;; esac; done; [ "${#signature}" -ge 128 ] || refuse; /usr/bin/printf '%s.%s.%s' "$header" "$payload" "$signature"; }
verified_task7_node() { node="$root/tools/node/bin/node"; node_receipt="$root/node-receipt.json"; node_receipt_sha="$root/node-receipt.sha256"; for file in "$node" "$node_receipt" "$node_receipt_sha" "$root/node.tar.xz" "$root/node-shasums.txt" "$root/node-shasums.sig" "$root/node-keyring.kbx"; do assert_child "$root" "$file"; done; for file in "$node_receipt" "$node_receipt_sha" "$root/node.tar.xz" "$root/node-shasums.txt" "$root/node-shasums.sig" "$root/node-keyring.kbx"; do [ "$(file_mode "$file")" = 400 ] || refuse; done; [ "$(file_mode "$node")" = 500 ] || refuse; [ "$(/usr/bin/awk 'NR==1 {print; next} {exit 1}' "$node_receipt_sha")" = "$(sha256 "$node_receipt")" ] && [ "$(json_get "$node_receipt" schemaVersion)" = 1 ] && [ "$(json_get "$node_receipt" version)" = "$(json_get "$policy" supplyChain.node.version)" ] && [ "$(json_get "$node_receipt" binary.path)" = tools/node/bin/node ] && [ "$(json_get "$node_receipt" binary.mode)" = 500 ] && [ "$(json_get "$node_receipt" binary.sha256)" = "$(sha256 "$node")" ] && [ "$(json_get "$node_receipt" archiveSha256)" = "$(sha256 "$root/node.tar.xz")" ] && [ "$(json_get "$node_receipt" archiveSha256)" = "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" ] && [ "$(json_get "$node_receipt" checksumSha256)" = "$(sha256 "$root/node-shasums.txt")" ] && [ "$(json_get "$node_receipt" checksumSha256)" = "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" ] && [ "$(json_get "$node_receipt" signatureSha256)" = "$(sha256 "$root/node-shasums.sig")" ] && [ "$(json_get "$node_receipt" signatureSha256)" = "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" ] && [ "$(json_get "$node_receipt" keyringSha256)" = "$(sha256 "$root/node-keyring.kbx")" ] && [ "$(json_get "$node_receipt" keyringSha256)" = "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" ] && [ "$("$node" --version 2>/dev/null)" = "v$(json_get "$policy" supplyChain.node.version)" ] || refuse; /usr/bin/printf '%s' "$node"; }
exec_task7() {
  [ "$purpose" = task7-provisioning ] || refuse
  gh="$root/tools/gh/bin/gh"
  # shellcheck disable=SC2016
  case $operation in
    (set-auditor-private-key) input="$root/private-key.pem"; assert_owner_input "$input" pem; exec "$gh" secret set BACI_CWV_RUNNER_AUDITOR_PRIVATE_KEY --repo "$REPOSITORY" <"$input";;
    (set-auditor-app-id) input="$root/auditor-app-id"; assert_owner_input "$input" numeric; exec "$gh" variable set BACI_CWV_RUNNER_AUDITOR_APP_ID --repo "$REPOSITORY" <"$input";;
    (set-auditor-client-id) input="$root/auditor-client-id"; assert_owner_input "$input" client_id; exec "$gh" variable set BACI_CWV_RUNNER_AUDITOR_CLIENT_ID --repo "$REPOSITORY" <"$input";;
    (set-auditor-installation-id) input="$root/auditor-installation-id"; assert_owner_input "$input" numeric; exec "$gh" variable set BACI_CWV_RUNNER_AUDITOR_INSTALLATION_ID --repo "$REPOSITORY" <"$input";;
    (read-auditor-app-registration) jwt=$(app_jwt) || refuse; node=$(verified_task7_node) || refuse; printf '%s' "$jwt" | exec /usr/bin/env -i "$node" --input-type=module -e 'import https from "node:https";let jwt="";for await(const chunk of process.stdin){jwt+=chunk;if(jwt.length>4096)process.exit(65)}if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt))process.exit(65);const fail=()=>{process.exitCode=65};let request;const deadline=setTimeout(()=>{fail();request?.destroy()},30000);request=https.request({agent:false,headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${jwt}`,"User-Agent":"baci-cwv-owner-verifier","X-GitHub-Api-Version":"2026-03-10"},hostname:"api.github.com",method:"GET",path:"/app",port:443,protocol:"https:"},response=>{let bytes=0;const chunks=[];response.on("data",chunk=>{bytes+=chunk.length;if(bytes>1048576){clearTimeout(deadline);fail();request.destroy();return}chunks.push(chunk)});response.on("end",()=>{clearTimeout(deadline);if(response.statusCode!==200||bytes>1048576){fail();return}const body=Buffer.concat(chunks);try{JSON.parse(body)}catch{fail();return}process.stdout.write(body)});response.on("error",()=>{clearTimeout(deadline);fail();request.destroy()})});request.setTimeout(30000,()=>{fail();request.destroy()});request.on("error",()=>{clearTimeout(deadline);fail()});request.end();';;
    (read-repository-retention) exec "$gh" api --method GET -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/actions/permissions/artifact-and-log-retention";;
    (read-rollout-ruleset) exec "$gh" api --method GET -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/rulesets";;
    (upsert-rollout-ruleset)
      body=$(ruleset_body) || refuse; write_request "$root/ruleset-request.json" "$body"; id=$(existing_ruleset_id)
      write_request "$root/ruleset-binding.json" "{\"id\":${id:-null},\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\"}"; write_request "$root/ruleset-mutation-intent.json" "{\"operation\":\"upsert-rollout-ruleset\",\"requestSha256\":\"$(sha256 "$root/ruleset-request.json")\",\"schemaVersion\":1}"; response="$root/ruleset-response.json"
      [ ! -e "$response" ] && [ ! -L "$response" ] || refuse
      if [ -n "$id" ]; then "$gh" api --method PATCH -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/rulesets/$id" --input "$root/ruleset-request.json" >"$response" || refuse; else "$gh" api --method POST -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/rulesets" --input "$root/ruleset-request.json" >"$response" || refuse; fi
      /bin/chmod 0400 "$response"; assert_child "$root" "$response"; actual=$(json_get "$response" id); case $actual in (*[!0-9]*|'') refuse;; esac; [ -z "$id" ] || [ "$actual" = "$id" ] || refuse
      request_sha=$(sha256 "$root/ruleset-request.json"); write_atomic "$root/ruleset-activated.json" "{\"id\":$actual,\"requestSha256\":\"$request_sha\"}" 0400; ruleset_reconciliation publication-intent '[]' '["H0_RUNNER_RULESET_ID","H0_RUNNER_RULESET_SHA256"]'
      readback="$root/ruleset-readback.json"; [ ! -e "$readback" ] && [ ! -L "$readback" ] || refuse; if "$gh" api --method GET -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/rulesets/$actual" >"$readback"; then /bin/chmod 0400 "$readback"; assert_child "$root" "$readback"; [ "$(json_get "$readback" id)" = "$actual" ] && [ "$(ruleset_readback_body "$readback")" = "$body" ] || return 0; else return 0; fi
      if /usr/bin/printf '%s\n' "$actual" | "$gh" variable set H0_RUNNER_RULESET_ID --repo "$REPOSITORY" >/dev/null; then ruleset_reconciliation id-published '["H0_RUNNER_RULESET_ID"]' '["H0_RUNNER_RULESET_SHA256"]'; else return 0; fi
      if /usr/bin/printf '%s\n' "$request_sha" | "$gh" variable set H0_RUNNER_RULESET_SHA256 --repo "$REPOSITORY" >/dev/null; then ruleset_reconciliation sha-published '["H0_RUNNER_RULESET_ID","H0_RUNNER_RULESET_SHA256"]' '[]'; else return 0; fi; ruleset_reconciliation publication-complete '["H0_RUNNER_RULESET_ID","H0_RUNNER_RULESET_SHA256"]' '[]'; /bin/cat "$response";;
    (create-owned-probe-tag-object) create_probe_tag_object;;
    (create-owned-probe-ref) create_probe_ref;;
    (read-owned-probe-ref)
      verify_probe_binding
      ref=$(probe_ref) || refuse; ref=${ref#refs/tags/}
      exec "$gh" api --method GET -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/ref/tags/$ref";;
    (rollback-owned-probe-ref)
      verify_probe_receipt; [ ! -e "$root/ruleset-activated.json" ] && [ ! -L "$root/ruleset-activated.json" ] || refuse
      ref=$(probe_ref) || refuse; ref=${ref#refs/tags/}
      exec "$gh" api --method DELETE -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/refs/tags/$ref";;
    (assert-owned-probe-duplicate-create)
      ruleset_active; probe_files; expect_refusal "$root/probe-$probe_id-duplicate-create-refusal" 'https://docs.github.com/rest/git/refs#create-a-reference' duplicate "$gh" api --include --method POST -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/refs" --input "$ref_request";;
    (assert-owned-probe-update|assert-owned-probe-force-update)
      ruleset_active; ref=${ref#refs/tags/}; case $operation in (*force*) force=true;; (*) force=false;; esac
      write_request "$root/probe-$probe_id-${operation#assert-owned-probe-}-request.json" "{\"force\":$force,\"sha\":\"$(probe_sha)\"}"; expect_refusal "$root/probe-$probe_id-${operation#assert-owned-probe-}-refusal" 'https://docs.github.com/rest/git/refs#update-a-reference' update "$gh" api --include --method PATCH -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/refs/tags/$ref" --input "$root/probe-$probe_id-${operation#assert-owned-probe-}-request.json";;
    (assert-owned-probe-delete)
      ruleset_active; ref=${ref#refs/tags/}; expect_refusal "$root/probe-$probe_id-delete-refusal" 'https://docs.github.com/rest/git/refs#delete-a-reference' delete "$gh" api --include --method DELETE -H "X-GitHub-Api-Version: $API_VERSION" "/repos/$REPOSITORY/git/refs/tags/$ref";;
    (*) refuse;;
  esac
}
emit_task9_token() { [ "$purpose" = task9-exact-run ] || refuse; exec "$root/tools/gh/bin/gh" auth token; }
[ "$#" -gt 0 ] || refuse; case $1 in
  (--verify-source) shift; verify_source "$@";;
  (--prepare-task9-bootstrap-node) shift; prepare_task9_bootstrap_node "$@";;
  (*) parse_common "$@"; verify_cli; case $mode in (verify) :;; (exec) exec_task7;; (token) emit_task9_token;; (*) refuse;; esac;;
esac
