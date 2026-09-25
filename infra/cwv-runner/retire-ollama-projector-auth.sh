#!/bin/sh
# Receipt-bound projector source selection for the running-container scanner.

running_container_projector_stat() {
  if [ "${running_projector_uid:-}" -ne 0 ] 2>/dev/null &&
    [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then
    "$RETIRE_OLLAMA_TEST_BIN/stat" "$@"
  else
    /usr/bin/stat "$@"
  fi
}

running_container_projector_private_file() {
  running_projector_file=$1
  running_projector_mode=$2
  [ -f "$running_projector_file" ] && [ ! -L "$running_projector_file" ] || return 2
  [ "$(running_container_projector_stat -c '%u:%g:%a:%h' -- "$running_projector_file")" = "$running_projector_uid:$running_projector_gid:$running_projector_mode:1" ] || return 2
}

running_container_projector_snapshot() {
  running_projector_snapshot_source=$1
  running_projector_snapshot_target=$2
  running_projector_snapshot_limit=$3
  running_projector_snapshot_uid=$4
  running_projector_snapshot_gid=$5
  /usr/bin/perl -MFcntl=O_RDONLY,O_NOFOLLOW,O_WRONLY,O_CREAT,O_EXCL -e 'my($source,$target,$limit,$uid,$gid)=@ARGV;sub fail{exit 2};my@before=lstat($source);fail()unless @before&&($before[2]&0170000)==0100000&&$before[3]==1&&$before[4]==$uid&&$before[5]==$gid&&($before[2]&0777)==0600&&$before[7]<=$limit;sysopen(my$in,$source,O_RDONLY|O_NOFOLLOW)or fail();my@opened=stat($in);fail()unless @opened&&$opened[0]==$before[0]&&$opened[1]==$before[1]&&$opened[2]==$before[2]&&$opened[3]==$before[3]&&$opened[4]==$before[4]&&$opened[5]==$before[5]&&$opened[7]==$before[7];my$bytes="";while(1){my$n=sysread($in,my$chunk,65536);defined$n or fail();last unless$n;$bytes.=$chunk;length($bytes)<=$limit or fail()}my@after=lstat($source);fail()unless @after&&$after[0]==$opened[0]&&$after[1]==$opened[1]&&$after[2]==$opened[2]&&$after[3]==$opened[3]&&$after[4]==$opened[4]&&$after[5]==$opened[5]&&$after[7]==$opened[7];close($in)or fail();sysopen(my$out,$target,O_WRONLY|O_CREAT|O_EXCL,0600)or fail();print $out $bytes or fail();close($out)or fail();' "$running_projector_snapshot_source" "$running_projector_snapshot_target" "$running_projector_snapshot_limit" "$running_projector_snapshot_uid" "$running_projector_snapshot_gid" || return 2
}

running_container_projector_canonical_dir() { [ -d "$1" ] && [ ! -L "$1" ] || return 2; if [ "${running_projector_uid:-0}" -ne 0 ] 2>/dev/null && [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ]; then return 0; fi; [ "$(CDPATH='' cd -- "$1" 2>/dev/null && /bin/pwd -P)" = "$1" ]; }
running_container_projector_fixed_ancestry() { running_projector_ancestry_root=$1; case "$running_projector_ancestry_root" in /var/lib/baci-cwv/preflight-source|/var/lib/baci-cwv/preflight-receipts) set -- /var /var/lib /var/lib/baci-cwv "$running_projector_ancestry_root";; /srv/baci-cwv/source|/srv/baci-cwv/source-receipts) set -- /srv /srv/baci-cwv "$running_projector_ancestry_root";; *) set -- "$(dirname -- "$running_projector_ancestry_root")" "$running_projector_ancestry_root";; esac; for running_projector_ancestry_path do running_container_projector_canonical_dir "$running_projector_ancestry_path" || return 2; done; }
running_container_projector_snapshot_base_safe() {
  running_projector_snapshot_base_identity=$(running_container_projector_stat -c '%u:%g:%a' -- "$running_projector_snapshot_base") || return 2
  running_projector_snapshot_base_owner=${running_projector_snapshot_base_identity%%:*}
  running_projector_snapshot_base_rest=${running_projector_snapshot_base_identity#*:}
  running_projector_snapshot_base_group=${running_projector_snapshot_base_rest%%:*}
  running_projector_snapshot_base_mode=${running_projector_snapshot_base_rest#*:}
  case "$running_projector_snapshot_base_owner:$running_projector_snapshot_base_group:$running_projector_snapshot_base_mode" in
    *[!0-9:]*|*:*:) return 2;;
  esac
  [ "$running_projector_snapshot_base_owner" = "$running_projector_uid" ] &&
    [ "$running_projector_snapshot_base_group" = "$running_projector_gid" ] ||
    [ $((0$running_projector_snapshot_base_mode & 01000)) -ne 0 ] || return 2
  [ $((0$running_projector_snapshot_base_mode & 0022)) -eq 0 ] ||
    [ $((0$running_projector_snapshot_base_mode & 01000)) -ne 0 ] || return 2
}
running_container_projector_snapshot_cleanup() {
  running_projector_cleanup_path=${running_projector_snapshot_dir:-}
  running_projector_cleanup_identity=${running_projector_snapshot_identity:-}
  case "$running_projector_cleanup_path" in "${running_projector_snapshot_base:-}"/baci-projector-auth.*) :;; *) return 0;; esac
  [ -n "$running_projector_cleanup_identity" ] && [ -d "$running_projector_cleanup_path" ] && [ ! -L "$running_projector_cleanup_path" ] || return 0
  [ "$(running_container_projector_stat -c '%d:%i' -- "$running_projector_cleanup_path" 2>/dev/null)" = "$running_projector_cleanup_identity" ] || return 0
  running_projector_cleanup_quarantine=$(/usr/bin/mktemp -d "${running_projector_cleanup_path}.cleanup.XXXXXX") || return 0
  /bin/chmod 700 "$running_projector_cleanup_quarantine" 2>/dev/null || { /bin/rmdir "$running_projector_cleanup_quarantine" 2>/dev/null || :; return 0; }
  running_projector_cleanup_payload="$running_projector_cleanup_quarantine/payload"
  /bin/mv "$running_projector_cleanup_path" "$running_projector_cleanup_payload" 2>/dev/null || { /bin/rmdir "$running_projector_cleanup_quarantine" 2>/dev/null || :; return 0; }
  [ -d "$running_projector_cleanup_payload" ] && [ ! -L "$running_projector_cleanup_payload" ] || return 0
  running_projector_cleanup_quarantine_identity=$(running_container_projector_stat -c '%d:%i' -- "$running_projector_cleanup_payload" 2>/dev/null) || return 0
  [ "$running_projector_cleanup_quarantine_identity" = "$running_projector_cleanup_identity" ] || return 0
  /bin/rm -rf -- "$running_projector_cleanup_quarantine" || :
}

running_container_projector_execute() {
  /usr/bin/perl -MFcntl=O_RDONLY,O_NOFOLLOW -MDigest::SHA=sha256_hex - "$@" <<'PERL'
my($seconds,$projector,$archive,$scratch,$expected)=@ARGV;
sub fail { exit 125 }
sub valid { my($s)=@_; return @$s && ($s->[2]&0170000)==0100000 && $s->[4]==$> && ($s->[2]&0022)==0 && $s->[3]==1 && $s->[7]<=2097152 }
sub same { my($a,$b)=@_; return valid($a)&&valid($b)&&$a->[0]==$b->[0]&&$a->[1]==$b->[1]&&$a->[2]==$b->[2]&&$a->[3]==$b->[3]&&$a->[4]==$b->[4]&&$a->[5]==$b->[5]&&$a->[7]==$b->[7] }
fail unless $seconds=~/^[0-9]+$/ && $expected=~/^[a-f0-9]{64}$/;
my@before=lstat($projector); fail unless valid(\@before);
sysopen(my$source,$projector,O_RDONLY|O_NOFOLLOW) or fail();
my@opened=stat($source); my@after=lstat($projector);
fail unless same(\@before,\@opened)&&same(\@opened,\@after);
my$bytes=""; my$total=0;
while(1){ my$n=sysread($source,my$chunk,65536); defined$n or fail(); last unless$n; $total+=$n; $total<=2097152 or fail(); $bytes.=$chunk }
fail unless sha256_hex($bytes) eq $expected;
my@verified=lstat($projector); fail unless same(\@opened,\@verified);
close($source) or fail();
my$pid=open(my$pipe,"|-","/usr/bin/perl","-e",q{my$pgrp=setpgrp(0,0);defined($pgrp)&&$pgrp>=0 or die;exec "/usr/bin/perl","-",$ARGV[0],$ARGV[1]or die;},$archive,$scratch) or fail();
my$terminate=sub{ kill 9,-$pid; kill 9,$pid; waitpid($pid,0); exit 125 };
$SIG{PIPE}='IGNORE';
$SIG{ALRM}=sub{ kill 9,-$pid; kill 9,$pid; waitpid($pid,0); exit 124 } if $seconds>0;
alarm $seconds if $seconds>0;
my$offset=0; my$length=length$bytes;
while($offset<$length){ my$want=$length-$offset; $want=65536 if $want>65536; my$w=syswrite($pipe,$bytes,$want,$offset); defined$w&&$w>0 or $terminate->(); $offset+=$w }
my@final=lstat($projector); same(\@opened,\@final) or $terminate->();
my$closed=close($pipe); my$status=$?; alarm 0; my$code=$status>>8; my$signal=$status&127;
exit 125 if $signal || (!$closed && $code != 1); exit $code;
PERL
}

running_container_projector_authorize() (
  running_projector=$1
  running_projector_source_root=''; running_projector_receipt_root=''
  running_projector_uid=$(/usr/bin/id -u); running_projector_gid=$(/usr/bin/id -g)
  if [ "$running_projector_uid" -eq 0 ]; then
    [ -z "${RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT:-}" ] && [ -z "${RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT:-}" ] || return 2
    case "$SCRIPT_DIR" in
      /var/lib/baci-cwv/preflight-source/*)
        running_projector_source_root=/var/lib/baci-cwv/preflight-source; running_projector_receipt_root=/var/lib/baci-cwv/preflight-receipts ;;
      /srv/baci-cwv/source/*)
        running_projector_source_root=/srv/baci-cwv/source; running_projector_receipt_root=/srv/baci-cwv/source-receipts ;;
      *) return 2 ;;
    esac
  else
    [ -n "${RETIRE_OLLAMA_TEST_BIN:-}" ] && [ -n "${RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT:-}" ] && [ -n "${RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT:-}" ] || return 2
    running_projector_source_root=$RETIRE_OLLAMA_PROJECTOR_TEST_SOURCE_ROOT
    running_projector_receipt_root=$RETIRE_OLLAMA_PROJECTOR_TEST_RECEIPT_ROOT
  fi
  running_projector_source_sha=${SCRIPT_DIR##*/}
  printf '%s\n' "$running_projector_source_sha" | /usr/bin/grep -Eq '^[a-f0-9]{40}$' || return 2
  [ "$SCRIPT_DIR" = "$running_projector_source_root/$running_projector_source_sha" ] || return 2
  [ "$running_projector" = "$SCRIPT_DIR/retire-ollama-image-filesystem.pl" ] || return 2
  running_container_projector_fixed_ancestry "$running_projector_source_root" || return 2
  running_container_projector_fixed_ancestry "$running_projector_receipt_root" || return 2
  running_container_projector_canonical_dir "$SCRIPT_DIR" || return 2
  running_projector_receipt_dir="$running_projector_receipt_root/$running_projector_source_sha"
  running_container_projector_canonical_dir "$running_projector_receipt_dir" || return 2
  [ "$(running_container_projector_stat -c '%u:%g:%a' -- "$running_projector_source_root")" = "$running_projector_uid:$running_projector_gid:700" ] || return 2
  [ "$(running_container_projector_stat -c '%u:%g:%a' -- "$SCRIPT_DIR")" = "$running_projector_uid:$running_projector_gid:700" ] || return 2
  [ "$(running_container_projector_stat -c '%u:%g:%a' -- "$running_projector_receipt_root")" = "$running_projector_uid:$running_projector_gid:700" ] || return 2
  [ "$(running_container_projector_stat -c '%u:%g:%a' -- "$running_projector_receipt_dir")" = "$running_projector_uid:$running_projector_gid:700" ] || return 2
  running_projector_manifest="$running_projector_receipt_dir/manifest.json"
  running_projector_manifest_digest="$running_projector_receipt_dir/manifest.sha256"
  running_projector_seal="$running_projector_receipt_dir/seal-receipt.json"
  running_container_projector_private_file "$running_projector_manifest" 600 || return 2
  running_container_projector_private_file "$running_projector_manifest_digest" 600 || return 2
  running_container_projector_private_file "$running_projector_seal" 600 || return 2
  running_projector_snapshot_base=${TEMP_ROOT:-${TMPDIR:-/tmp}}
  case "$running_projector_snapshot_base" in /*) :;; *) return 2;; esac
  running_projector_snapshot_base=$(CDPATH='' cd -- "$running_projector_snapshot_base" 2>/dev/null && /bin/pwd -P) || return 2
  [ -d "$running_projector_snapshot_base" ] && [ ! -L "$running_projector_snapshot_base" ] || return 2
  running_container_projector_snapshot_base_safe || return 2
  running_projector_snapshot_dir=$(/usr/bin/mktemp -d "$running_projector_snapshot_base/baci-projector-auth.XXXXXX") || return 2
  trap running_container_projector_snapshot_cleanup EXIT HUP INT TERM
  running_projector_snapshot_identity=$(running_container_projector_stat -c '%d:%i' -- "$running_projector_snapshot_dir") || return 2
  /bin/chmod 700 "$running_projector_snapshot_dir" || return 2
  running_projector_manifest_source=$running_projector_manifest
  running_projector_manifest_digest_source=$running_projector_manifest_digest
  running_projector_seal_source=$running_projector_seal
  running_projector_manifest="$running_projector_snapshot_dir/manifest.json"
  running_projector_manifest_digest="$running_projector_snapshot_dir/manifest.sha256"
  running_projector_seal="$running_projector_snapshot_dir/seal-receipt.json"
  running_container_projector_snapshot "$running_projector_manifest_source" "$running_projector_manifest" 16777216 "$running_projector_uid" "$running_projector_gid" || return 2
  running_container_projector_snapshot "$running_projector_manifest_digest_source" "$running_projector_manifest_digest" 4096 "$running_projector_uid" "$running_projector_gid" || return 2
  running_container_projector_snapshot "$running_projector_seal_source" "$running_projector_seal" 1048576 "$running_projector_uid" "$running_projector_gid" || return 2
  running_projector_manifest_size=$(running_container_projector_stat -c '%s' -- "$running_projector_manifest") || return 2
  [ "$running_projector_manifest_size" -le 16777216 ] || return 2
  [ "$(/usr/bin/wc -l <"$running_projector_manifest_digest" | /usr/bin/tr -d '[:space:]')" = 1 ] || return 2
  running_projector_manifest_sha=$(/bin/cat -- "$running_projector_manifest_digest") || return 2
  printf '%s\n' "$running_projector_manifest_sha" | /usr/bin/grep -Eq '^[a-f0-9]{64}$' || return 2
  [ "$(sha "$running_projector_manifest")" = "$running_projector_manifest_sha" ] || return 2
  running_projector_manifest_canonical=$(/usr/bin/jq -cS -j . "$running_projector_manifest") || return 2
  [ "$running_projector_manifest_canonical" = "$(/bin/cat -- "$running_projector_manifest")" ] || return 2
  /usr/bin/jq -e --arg source "$running_projector_source_sha" '
    def sha40: type == "string" and test("^[a-f0-9]{40}$");
    def sha64: type == "string" and test("^[a-f0-9]{64}$");
    def safeInt: type == "number" and floor == . and . > 0 and . <= 9007199254740991;
    def authority: type == "object" and (keys == ["deploymentMarker","deploymentRunAttempt","deploymentRunId","implementationBaseSha","normativeContractPath","normativeContractSha256"]) and
      (.deploymentMarker | type == "string" and length > 0) and (.deploymentRunAttempt | safeInt) and
      (.deploymentRunId | safeInt) and (.implementationBaseSha | sha40) and
      (.normativeContractPath | type == "string" and length > 0) and (.normativeContractSha256 | sha64);
    def safe_path: type == "string" and length > 0 and (startswith("/") | not) and (contains("\\") | not) and (split("/") | all(. != "" and . != "." and . != ".."));
    def changed: ((.status == "D" and keys == ["absent","path","status"] and .absent == true) or
      ((.status == "A" or .status == "M") and keys == ["blobSha256","mode","path","status"] and (.blobSha256 | sha64) and (.mode == "100644" or .mode == "100755"))) and
      (.path | safe_path);
    def archive: keys == ["blobSha256","mode","path"] and (.blobSha256 | sha64) and (.mode == "100644" or .mode == "100755") and
      (.path | safe_path and startswith("infra/cwv-runner/"));
    ((.schemaVersion == 1 and keys == ["authority","baseSha","entries","mergeSha","policyCanonicalSha256","policyFileSha256","prNumber","reviewedHeadSha","schemaVersion","sourceArchive"] and .mergeSha == $source) or
      (.schemaVersion == "preflight-v1" and keys == ["authority","baseSha","entries","policyCanonicalSha256","policyFileSha256","prNumber","reviewedHeadSha","schemaVersion","sourceArchive"] and .reviewedHeadSha == $source)) and
    (.authority | authority) and (.baseSha | sha40) and (.entries | type == "array" and all(.[]; changed) and ([.[].path] == ([.[].path] | sort))) and
      (.policyCanonicalSha256 | sha64) and (.policyFileSha256 | sha64) and (.prNumber | safeInt) and
    (.reviewedHeadSha | sha40) and (.sourceArchive | type == "object" and keys == ["entries","prefix"] and .prefix == "infra/cwv-runner/" and (.entries | type == "array" and length > 0 and all(.[]; archive) and ([.[].path] == ([.[].path] | sort))))
  ' "$running_projector_manifest" >/dev/null || return 2
  /usr/bin/jq -e --arg source "$running_projector_source_sha" --arg manifest "$running_projector_manifest_sha" '
    (keys == ["archiveSha256","manifestSha256","schemaVersion","sealedTreeSha256","sourceSha"]) and
    .schemaVersion == 1 and .sourceSha == $source and .manifestSha256 == $manifest and
    (.archiveSha256 | test("^[a-f0-9]{64}$")) and (.sealedTreeSha256 | test("^[a-f0-9]{64}$"))
  ' "$running_projector_seal" >/dev/null || return 2
  running_projector_expected_sha=$(/usr/bin/jq -er --arg path 'infra/cwv-runner/retire-ollama-image-filesystem.pl' '
    [.sourceArchive.entries[] | select(.path == $path)] |
    if length == 1 and .[0].mode == "100644" and (.[0].blobSha256 | test("^[a-f0-9]{64}$")) then .[0].blobSha256 else error("projector manifest row refused") end
  ' "$running_projector_manifest") || return 2
  running_container_projector_private_file "$running_projector" 644 || return 2
  printf '%s\n' "$running_projector_expected_sha"
)
