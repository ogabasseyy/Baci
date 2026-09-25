#!/bin/bash -p
set -euo pipefail
PATH=/usr/bin:/bin
export LC_ALL=C

readonly SHA=/usr/bin/sha256sum
readonly STAT=/usr/bin/stat
readonly CP=/bin/cp
readonly CHMOD=/bin/chmod
readonly CHOWN=/bin/chown
readonly MKDIR=/bin/mkdir
readonly RM=/bin/rm
readonly TAR=/usr/bin/tar
readonly FIND=/usr/bin/find
readonly SORT=/usr/bin/sort
readonly GREP=/usr/bin/grep
readonly AWK=/usr/bin/awk
readonly JQ=/usr/bin/jq
readonly SYNC=/usr/bin/sync
readonly FLOCK=/usr/bin/flock
readonly MKTEMP=/usr/bin/mktemp
readonly LN=/bin/ln
readonly PERL=/usr/bin/perl
readonly SELF=${BASH_SOURCE[0]}
readonly SELF_ROOT=/var/lib/baci-cwv/seal-source
readonly SELF_PARENT=${SELF%/*}
outer_self_copy=''

fail() { printf '%s\n' "seal-source: $*" >&2; exit 1; }
# Awk owns its field expressions.
# shellcheck disable=SC2016
sha() { "$SHA" -- "$1" | "$AWK" '{print $1}'; }
hex() { [[ "$1" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid digest'; }
git_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid source SHA'; }

secure_self_root() {
  [[ -d "$SELF_ROOT" && ! -L "$SELF_ROOT" ]] || fail 'unsafe self-copy root'
  "$CHOWN" root:root -- "$SELF_ROOT"; "$CHMOD" 0700 -- "$SELF_ROOT"
  [[ "$("$STAT" -c '%u:%a' -- "$SELF_ROOT")" == '0:700' ]] || fail 'unsafe self-copy root'
}

validate_fixed_dir() {
  local path=$1 strict=${2:-false} owner_mode owner mode
  [[ ! -L "$path" ]] || fail 'unsafe fixed root ancestry'
  [[ ! -e "$path" ]] && return 0
  [[ -d "$path" ]] || fail 'unsafe fixed root ancestry'
  owner_mode=$("$STAT" -c '%u:%a' -- "$path") || fail 'unsafe fixed root ancestry'
  owner=${owner_mode%%:*}; mode=${owner_mode##*:}
  [[ "$owner" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || fail 'unsafe fixed root ancestry'
  [[ "$strict" != true || "$mode" == 700 ]] || fail 'unsafe fixed root'
  [[ "$strict" == true ]] || (( (8#$mode & 0022) == 0 )) || fail 'unsafe fixed root ancestry'
}

assert_known_root() { case "$1" in /var/lib/baci-cwv/preflight-source|/var/lib/baci-cwv/preflight-receipts|/srv/baci-cwv/source|/srv/baci-cwv/source-receipts) ;; *) fail 'invalid fixed root' ;; esac; }
fixed_root_chain() {
  case "$1" in
    /var/lib/baci-cwv/preflight-source|/var/lib/baci-cwv/preflight-receipts) printf '%s\n' /var /var/lib /var/lib/baci-cwv "$1" ;;
    /srv/baci-cwv/source|/srv/baci-cwv/source-receipts) printf '%s\n' /srv /srv/baci-cwv "$1" ;;
    *) fail 'invalid fixed root' ;;
  esac
}

validate_fixed_root() {
  local root=$1 dir strict=false
  assert_known_root "$root"
  while IFS= read -r dir; do [[ "$dir" == "$root" ]] && strict=true || strict=false; validate_fixed_dir "$dir" "$strict"; done < <(fixed_root_chain "$root")
}

prepare_fixed_root() {
  local root=$1 dir strict=false mode=0755
  assert_known_root "$root"
  while IFS= read -r dir; do
    if [[ "$dir" == "$root" ]]; then strict=true; mode=0700; else strict=false; mode=0755; fi
    validate_fixed_dir "$dir"
    [[ -e "$dir" ]] || { "$MKDIR" -m "$mode" -- "$dir" || fail 'fixed root creation failed'; }
    validate_fixed_dir "$dir" "$strict"
  done < <(fixed_root_chain "$root")
}

absent_leaf() {
  [[ ! -L "$1" && ! -e "$1" ]] || fail 'sealed destination already exists'
}

prepare_self_root() { validate_fixed_dir /var; validate_fixed_dir /var/lib; validate_fixed_dir /var/lib/baci-cwv; [[ -e /var/lib/baci-cwv ]] || "$MKDIR" -m 0700 -- /var/lib/baci-cwv || fail 'unsafe self-copy root'; validate_fixed_dir /var/lib/baci-cwv; [[ ! -L "$SELF_ROOT" ]] || fail 'unsafe self-copy root'; [[ -e "$SELF_ROOT" ]] || "$MKDIR" -m 0700 -- "$SELF_ROOT" || fail 'unsafe self-copy root'; secure_self_root; }
validate_self_parent() {
  local parent=$1 suffix=${1#"$SELF_ROOT/work."}
  [[ "$parent" == "$SELF_ROOT"/work.* && "$suffix" =~ ^[A-Za-z0-9]{8}$ && -d "$parent" && ! -L "$parent" ]] || fail 'unsafe self-copy parent'
  [[ "$("$STAT" -c '%u:%a' -- "$parent")" == '0:700' ]] || fail 'unsafe self-copy parent'
}

cleanup_outer_self_copy() { local parent=$outer_self_copy identity=$outer_self_copy_identity; outer_self_copy=''; outer_self_copy_identity=''; cleanup_owned_dir "$parent" "$identity"; }

outer_exit() { cleanup_outer_self_copy; }
outer_signal() {
  cleanup_outer_self_copy
  trap - EXIT HUP INT TERM
  exit "$1"
}

cleanup_self_copy() { cleanup_owned_dir "$SELF_PARENT" "$self_parent_identity"; }

tmp='' tmp_identity='' target='' receipt='' receipt_stage='' target_owned=false receipt_owned=false target_identity='' receipt_identity='' outer_self_copy_identity='' self_parent_identity='' committed=false
owned_path_matches() { local path=$1 identity=$2; [[ -n "$identity" && ! -L "$path" && -d "$path" ]] || return 1; [[ "$($STAT -c '%d:%i' -- "$path" 2>/dev/null)" == "$identity" ]]; }
cleanup_owned_dir() { local path=$1 identity=$2 quarantine; quarantine="${path}.cleanup.$$"; owned_path_matches "$path" "$identity" || return 0; atomic_noreplace_dir "$path" "$quarantine" || return 0; if owned_path_matches "$quarantine" "$identity"; then "$RM" -rf -- "$quarantine"; else atomic_noreplace_dir "$quarantine" "$path" || :; fi; }
cleanup_owned_path() { local path=$1 identity=$2; cleanup_owned_dir "$path" "$identity"; }
cleanup() {
  if [[ "$committed" != true ]]; then
    if [[ "$receipt_owned" == true ]]; then cleanup_owned_path "$receipt" "$receipt_identity"; fi; if [[ -n "$receipt_stage" ]]; then cleanup_owned_path "$receipt_stage" "$receipt_identity"; fi
    if [[ "$target_owned" == true ]]; then cleanup_owned_path "$target" "$target_identity"; fi
  fi
  if [[ -n "$tmp" ]]; then cleanup_owned_dir "$tmp" "$tmp_identity"; fi
  cleanup_self_copy
}

copy_receipt_file() {
  local source=$1 destination=$2 temporary directory; directory=${destination%/*}; temporary=$("$MKTEMP" "$directory/.tmp.XXXXXX") || fail 'receipt staging unavailable'; "$CP" --preserve=mode -- "$source" "$temporary" || fail 'receipt staging failed'; "$CHOWN" root:root -- "$temporary"; "$CHMOD" 0600 -- "$temporary"; "$SYNC" -f "$temporary" || fail 'receipt staging sync failed'; receipt_link "$temporary" "$destination"
}
write_receipt_file() {
  local destination=$1 value=$2 temporary directory; directory=${destination%/*}; temporary=$("$MKTEMP" "$directory/.tmp.XXXXXX") || fail 'receipt staging unavailable'; printf '%s\n' "$value" > "$temporary" || fail 'receipt staging write failed'; "$CHOWN" root:root -- "$temporary"; "$CHMOD" 0600 -- "$temporary"; "$SYNC" -f "$temporary" || fail 'receipt staging sync failed'; receipt_link "$temporary" "$destination"
}
receipt_link() { local source=$1 destination=$2 identity directory; directory=${destination%/*}; identity=$("$STAT" -c '%d:%i' -- "$source") || fail 'receipt staging identity unavailable'; "$LN" -T -- "$source" "$destination" || fail 'receipt destination already exists'; [[ "$($STAT -c '%d:%i' -- "$destination")" == "$identity" ]] || fail 'receipt destination identity changed'; regular "$destination"; "$RM" -f -- "$source" || fail 'receipt staging cleanup failed'; [[ "$($STAT -c '%d:%i' -- "$destination")" == "$identity" ]] || fail 'receipt destination identity changed'; "$SYNC" -f "$destination" || fail 'receipt publication sync failed'; "$SYNC" -f "$directory" || fail 'receipt directory sync failed'; }

atomic_noreplace_dir() { "$PERL" -MConfig -e 'my($source,$destination)=@ARGV;my($syscall,$from_fd,$to_fd,$flags);if($^O eq "darwin"){$syscall=488;($from_fd,$to_fd,$flags)=(-2,-2,4)}elsif($^O eq "linux"){$syscall=$Config{archname}=~/^x86_64/?316:$Config{archname}=~/aarch64|riscv64/?276:$Config{archname}=~/^arm/?382:$Config{archname}=~/i[3-6]86/?353:0;($from_fd,$to_fd,$flags)=(-100,-100,1)}exit 64 unless $syscall;exit syscall($syscall,$from_fd,$source,$to_fd,$destination,$flags)==0?0:1;' -- "$1" "$2"; } # renameatx_np(2) RENAME_EXCL; Linux renameat2(2) RENAME_NOREPLACE

signal() {
  local code=$2
  cleanup
  trap - EXIT HUP INT TERM
  exit "$code"
}

self_copy() {
  local expected=${BACI_CWV_SEAL_SOURCE_RAW_SHA:-} copied parent
  hex "$expected"
  [[ -f "$SELF" && ! -L "$SELF" ]] || fail 'helper is not a regular file'
  prepare_self_root
  parent=$("$MKTEMP" -d "$SELF_ROOT/work.XXXXXXXX") || fail 'self-copy directory unavailable'
  outer_self_copy=$parent; outer_self_copy_identity=$("$STAT" -c '%d:%i' -- "$parent") || fail 'self-copy identity unavailable'
  trap outer_exit EXIT
  trap 'outer_signal 129' HUP
  trap 'outer_signal 130' INT
  trap 'outer_signal 143' TERM
  "$CHOWN" root:root -- "$parent"; "$CHMOD" 0700 -- "$parent"; validate_self_parent "$parent"
  copied="$parent/seal-source.sh"; "$CP" -- "$SELF" "$copied"
  [[ "$(sha "$copied")" == "$expected" ]] || fail 'helper raw digest mismatch'
  "$CHOWN" root:root -- "$copied"; "$CHMOD" 0500 -- "$copied"
  exec "$copied" --sealed-inner "$@"
}

verify_inner_helper() {
  [[ "$SELF" == "$SELF_PARENT/seal-source.sh" && -f "$SELF" && ! -L "$SELF" ]] || fail 'unsafe sealed helper'
  [[ -d "$SELF_PARENT" && ! -L "$SELF_PARENT" ]] || fail 'unsafe sealed helper'
  validate_self_parent "$SELF_PARENT"; self_parent_identity=$("$STAT" -c '%d:%i' -- "$SELF_PARENT") || fail 'unsafe sealed helper'
  [[ "$("$STAT" -c '%u:%a' -- "$SELF")" == '0:500' ]] || fail 'unsafe sealed helper'
}

regular() {
  [[ -f "$1" && ! -L "$1" ]] || fail 'input is not a regular file'
  [[ "$($STAT -c '%u:%a' -- "$1")" == '0:600' || "$($STAT -c '%u:%a' -- "$1")" == '0:400' ]] || fail 'unsafe input ownership or mode'
}

digest_file() {
  regular "$1"
  local value
  value=$(<"$1")
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid digest file'
  printf '%s' "$value"
}

canonical_manifest() {
  local manifest=$1 source_sha=$2 destination=$3
  local schema='def exact($v;$k): ($v|type)=="object" and (($v|keys|sort)==($k|sort)); def sha($n): (type=="string" and test("^[0-9a-f]{"+($n|tostring)+"}$")); def safe_int: (type=="number" and floor==. and .>=1 and .<=9007199254740991); def safe_path: (type=="string" and length>0 and (startswith("/")|not) and (contains("\\")|not) and (test("[[:cntrl:]]")|not) and (split("/")|all(. != "" and . != "." and . != ".."))); def authority: (exact(.;["deploymentMarker","deploymentRunAttempt","deploymentRunId","implementationBaseSha","normativeContractPath","normativeContractSha256"]) and (.normativeContractPath|type)=="string" and (.normativeContractPath|length)>0 and (.normativeContractSha256|sha(64)) and (.implementationBaseSha|sha(40)) and (.deploymentRunId|safe_int) and (.deploymentRunAttempt|safe_int) and (.deploymentMarker|type)=="string" and (.deploymentMarker|length)>0); def archive_row: (exact(.;["blobSha256","mode","path"]) and (.blobSha256|sha(64)) and (.mode=="100644" or .mode=="100755") and (.path|safe_path) and (.path|startswith("infra/cwv-runner/"))); def changed_row: (if .status=="D" then (exact(.;["absent","path","status"]) and .absent==true and (.path|safe_path)) else (exact(.;["blobSha256","mode","path","status"]) and (.status=="A" or .status=="M") and (.blobSha256|sha(64)) and (.mode=="100644" or .mode=="100755") and (.path|safe_path)) end); if length != 1 then false else .[0] as $m | (($destination=="final" and exact($m;["authority","baseSha","entries","mergeSha","policyCanonicalSha256","policyFileSha256","prNumber","reviewedHeadSha","schemaVersion","sourceArchive"]) and $m.schemaVersion==1 and ($m.mergeSha==$source_sha)) or ($destination=="scan" and exact($m;["authority","baseSha","entries","policyCanonicalSha256","policyFileSha256","prNumber","reviewedHeadSha","schemaVersion","sourceArchive"]) and $m.schemaVersion=="preflight-v1" and ($m.reviewedHeadSha==$source_sha))) and ($m.prNumber|safe_int) and ($m.reviewedHeadSha|sha(40)) and ($m.baseSha|sha(40)) and ($m.policyFileSha256|sha(64)) and ($m.policyCanonicalSha256|sha(64)) and ($m.authority|authority) and ($m.entries|type)=="array" and all($m.entries[]?; changed_row) and ([ $m.entries[].path ] == ([ $m.entries[].path ] | sort)) and exact($m.sourceArchive;["entries","prefix"]) and $m.sourceArchive.prefix=="infra/cwv-runner/" and ($m.sourceArchive.entries|type)=="array" and ($m.sourceArchive.entries|length)>0 and all($m.sourceArchive.entries[]; archive_row) and ([ $m.sourceArchive.entries[].path ] == ([ $m.sourceArchive.entries[].path ] | sort)) end'
  "$JQ" -e -s --arg source_sha "$source_sha" --arg destination "$destination" "$schema" -- "$manifest" >/dev/null 2>&1 || fail 'manifest is not canonical schema-v1 JSON'
  "$JQ" -cS -j . -- "$manifest" | "$PERL" -e 'my ($path)=@ARGV; open my $fh, "<:raw", $path or exit 2; local $/; my $raw=<$fh>; my $canonical=<STDIN>; exit($raw eq $canonical ? 0 : 1);' -- "$manifest" || fail 'manifest is not canonical schema-v1 JSON'
  "$JQ" -e -s '.[0] as $m | (([$m.entries[]?.path] | unique | length) == ($m.entries | length)) and (([$m.sourceArchive.entries[]?.path] | unique | length) == ($m.sourceArchive.entries | length))' -- "$manifest" >/dev/null 2>&1 || fail 'manifest contains duplicate paths'
}

manifest_rows() {
  "$JQ" -r -s '.[0].sourceArchive.entries[] | [.path, .mode, .blobSha256] | @tsv' -- "$1" || fail 'manifest archive rows unavailable'
}

safe_archive_names() {
  "$TAR" --list --file "$1" | "$AWK" '
    /^\// || /(^|\/)\.\.($|\/)/ || /\/\/|^$/ { exit 1 }
    { print }
  ' || fail 'unsafe archive member name'
}

verify_tree() {
  local tree=$1 rows=$2 actual=$3
  "$FIND" "$tree" -mindepth 1 \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit | "$GREP" -q . && fail 'nonregular extracted member'
  "$FIND" "$tree" -type f -links +1 -print -quit | "$GREP" -q . && fail 'hardlinked extracted member'
  : > "$actual"
  while IFS=$'\t' read -r path mode digest; do
    [[ -n "$path" && "$path" == infra/cwv-runner/* ]] || fail 'invalid projected path'
    [[ "$path" != *'..'* && "$path" != /* ]] || fail 'unsafe projected path'
    local file="$tree/$path"
    [[ -f "$file" && ! -L "$file" && "$(sha "$file")" == "$digest" ]] || fail 'extracted member hash mismatch'
    "$CHMOD" "$([[ "$mode" == 100755 ]] && printf 0755 || printf 0644)" -- "$file"
    printf '%s\t%s\t%s\n' "$path" "$mode" "$digest" >> "$actual"
  done < "$rows"
  "$SORT" -c "$rows" || fail 'manifest archive rows are not sorted'
  local extracted
  extracted=$("$FIND" "$tree" -type f -print | "$AWK" -v root="$tree/" '{sub(root, ""); print}' | "$SORT")
  local expected
  # Awk prints the first manifest column.
  # shellcheck disable=SC2016
  expected=$("$AWK" -F'\t' '{print $1}' "$actual")
  [[ "$extracted" == "$expected" ]] || fail 'archive member set mismatch'
}

secure_tree_directories() {
  "$FIND" "$1" -type d -exec "$CHMOD" 0700 -- {} +
}

usage() { fail 'usage: seal-source.sh --destination scan|final --source-sha SHA --source-archive PATH --source-archive-sha256 SHA --source-manifest PATH --source-manifest-sha256 SHA'; }

inner=false
if [[ "${1:-}" == --sealed-inner ]]; then inner=true; shift; fi
arguments=("$@")
destination='' source_sha='' archive='' archive_digest='' manifest='' manifest_digest=''
while (($#)); do
  case "$1" in
    --destination|--source-sha|--source-archive|--source-archive-sha256|--source-manifest|--source-manifest-sha256)
      (($# >= 2)) || usage
      case "$1" in
        --destination) destination=$2 ;;
        --source-sha) source_sha=$2 ;;
        --source-archive) archive=$2 ;;
        --source-archive-sha256) archive_digest=$2 ;;
        --source-manifest) manifest=$2 ;;
        --source-manifest-sha256) manifest_digest=$2 ;;
      esac
      shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$destination" && -n "$source_sha" && -n "$archive" && -n "$archive_digest" && -n "$manifest" && -n "$manifest_digest" ]] || usage
git_sha "$source_sha"; hex "$archive_digest"; hex "$manifest_digest"
case "$destination" in
  scan) final_root=/var/lib/baci-cwv/preflight-source; receipt_root=/var/lib/baci-cwv/preflight-receipts ;;
  final) final_root=/srv/baci-cwv/source; receipt_root=/srv/baci-cwv/source-receipts ;;
  *) usage ;;
esac
# Validate both fixed roots before self-copy or any publication mutation.
validate_fixed_root "$final_root"; validate_fixed_root "$receipt_root"
if [[ "$inner" == true ]]; then
  verify_inner_helper
  secure_self_root
  trap cleanup EXIT
  trap 'signal HUP 129' HUP
  trap 'signal INT 130' INT
  trap 'signal TERM 143' TERM
  exec 9<"$SELF_ROOT"
  "$FLOCK" -n 9 || fail 'source seal already running'
else
  self_copy "${arguments[@]}"
fi
regular "$archive"; regular "$manifest"
target="$final_root/$source_sha"; receipt="$receipt_root/$source_sha"
absent_leaf "$target"; absent_leaf "$receipt"
prepare_fixed_root "$final_root"; prepare_fixed_root "$receipt_root"
absent_leaf "$target"; absent_leaf "$receipt"
tmp="$final_root/.seal-${source_sha}-$$"; "$MKDIR" -m 0700 -- "$tmp" || fail 'sealed temporary directory unavailable'; tmp_identity=$("$STAT" -c '%d:%i' -- "$tmp") || fail 'sealed temporary identity unavailable'
root_archive="$tmp/archive"; root_manifest="$tmp/manifest.json"
"$CP" --preserve=mode -- "$archive" "$root_archive"
"$CP" --preserve=mode -- "$manifest" "$root_manifest"
"$CHOWN" root:root -- "$root_archive" "$root_manifest"; "$CHMOD" 0600 -- "$root_archive" "$root_manifest"
regular "$root_archive"; regular "$root_manifest"
[[ "$(sha "$root_archive")" == "$archive_digest" && "$(sha "$root_manifest")" == "$manifest_digest" ]] || fail 'root-copied input digest mismatch'
canonical_manifest "$root_manifest" "$source_sha" "$destination"
rows="$tmp/rows"; actual="$tmp/actual"; tree="$tmp/tree"; projection="$tree/infra/cwv-runner"
manifest_rows "$root_manifest" > "$rows"; [[ -s "$rows" ]] || fail 'empty archive projection'
safe_archive_names "$root_archive"
"$MKDIR" -m 0700 -- "$tree"
"$TAR" --extract --file "$root_archive" --directory "$tree" --no-same-owner --no-same-permissions --no-recursion
verify_tree "$tree" "$rows" "$actual"
[[ -d "$projection" && ! -L "$projection" ]] || fail 'archive projection root missing'
"$CHOWN" -R root:root -- "$tree"; secure_tree_directories "$tree"
tree_digest=$(sha "$actual")
hex "$tree_digest" || fail 'sealed tree digest mismatch'
"$SYNC" -f "$root_manifest"; "$SYNC" -f "$root_archive"; "$SYNC" -f "$tree"
target_identity=$("$STAT" -c '%d:%i' -- "$projection") || fail 'sealed target identity unavailable'; target_owned=true
if atomic_noreplace_dir "$projection" "$target"; then :; else atomic_status=$?; case "$atomic_status" in 64) fail 'atomic no-replace publication unavailable';; *) fail 'sealed destination already exists';; esac; fi
[[ ! -e "$projection" && ! -L "$projection" && -d "$target" && ! -L "$target" ]] || fail 'sealed destination already exists'
receipt_stage="$receipt_root/.seal-receipt-${source_sha}-$$"
"$MKDIR" -m 0700 -- "$receipt_stage" || fail 'sealed receipt staging directory unavailable'
receipt_identity=$("$STAT" -c '%d:%i' -- "$receipt_stage") || fail 'sealed receipt identity unavailable'; receipt_owned=true
copy_receipt_file "$root_manifest" "$receipt_stage/manifest.json"
write_receipt_file "$receipt_stage/manifest.sha256" "$manifest_digest"
write_receipt_file "$receipt_stage/archive.sha256" "$archive_digest"
write_receipt_file "$receipt_stage/tree.sha256" "$tree_digest"
write_receipt_file "$receipt_stage/seal-receipt.json" "{\"archiveSha256\":\"$archive_digest\",\"manifestSha256\":\"$manifest_digest\",\"schemaVersion\":1,\"sealedTreeSha256\":\"$tree_digest\",\"sourceSha\":\"$source_sha\"}"
"$CHOWN" -R root:root -- "$target" "$receipt_stage" || fail 'sealed ownership hardening failed'; secure_tree_directories "$target" || fail 'sealed directory hardening failed'; "$CHMOD" 0700 -- "$receipt_stage" || fail 'receipt directory hardening failed'; "$CHMOD" 0600 -- "$receipt_stage"/* || fail 'receipt file hardening failed'; "$PERL" -MFile::Find -e 'find({no_chdir=>1,wanted=>sub{@s=lstat($_); exit 2 unless @s; return unless -d _; exit 2 unless $s[4]==0&&$s[5]==0&&($s[2]&0022)==0}},$ARGV[0])' "$target" || fail 'sealed directory verification failed'
"$SYNC" -f "$receipt_stage/seal-receipt.json" || fail 'receipt staging sync failed'; "$SYNC" -f "$receipt_stage" || fail 'receipt staging directory sync failed'; if atomic_noreplace_dir "$receipt_stage" "$receipt"; then receipt_stage=''; else atomic_status=$?; case "$atomic_status" in 64) fail 'atomic no-replace publication unavailable';; *) fail 'sealed destination already exists';; esac; fi
"$SYNC" -f "$receipt_root" || fail 'receipt root sync failed'; "$SYNC" -f "$final_root" || fail 'sealed root sync failed'
committed=true
cleanup
trap - EXIT HUP INT TERM
printf '%s\n' "$target"
