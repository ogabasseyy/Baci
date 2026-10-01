#!/bin/sh
set -eu
umask 077
refuse() { /usr/bin/printf '%s\n' 'task9 composition refused' >&2; exit 65; }
sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk 'NR==1 {print $1}'; }
json_get() { /usr/bin/plutil -extract "$2" raw -o - "$1" 2>/dev/null || refuse; }
mode() { /usr/bin/stat -f '%Lp' "$1" 2>/dev/null || refuse; }
owner() { /usr/bin/stat -f '%Su' "$1" 2>/dev/null || refuse; }
regular() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(owner "$1")" = "$(/usr/bin/id -un)" ] || refuse; }
digest() { /usr/bin/printf '%s' "$1" | /usr/bin/awk 'length == 64 && /^[0-9a-f]+$/ {ok=1} END {exit !ok}' || refuse; }

[ "$#" -ge 18 ] && [ "$1" = --transaction-dir ] && [ "$3" = --policy ] && [ "$5" = --reviewed-policy-sha256 ] && [ "$7" = --source-root ] && [ "$9" = --reviewed-helper-sha256 ] && [ "${11}" = --reviewed-launcher-sha256 ] && [ "${13}" = --reviewed-composer-sha256 ] && [ "${15}" = --github-sha256 ] && [ "${17}" = -- ] || refuse
transaction_dir=$2; policy=$4; reviewed_policy=$6; source_root=$8; reviewed_helper=${10}; reviewed_launcher=${12}; reviewed_composer=${14}; github_sha=${16}; shift 17
case "$transaction_dir" in (/private/tmp/baci-cwv-*) ;; (*) refuse;; esac
[ -d "$transaction_dir" ] && [ ! -L "$transaction_dir" ] && [ "$(mode "$transaction_dir")" = 700 ] || refuse
helper="$source_root/task9-compose-bundle.sh"; helper_copy="$transaction_dir/task9-compose-bundle.sh"; launcher_source="$source_root/task9-bootstrap-bundle-launcher.mjs"; composer="$source_root/task9-bootstrap-bundle-cli.mjs"; node="$transaction_dir/prepared-node/node"; provenance="$transaction_dir/prepared-node/node-provenance.json"; archive="$transaction_dir/node.tar.xz"; gh="$transaction_dir/tools/gh/bin/gh"; launcher="$transaction_dir/task9-bootstrap-bundle-launcher.mjs"; node_version="$(json_get "$policy" supplyChain.node.version)"; archive_member="node-v${node_version}-darwin-arm64/bin/node"
for value in "$reviewed_policy" "$reviewed_helper" "$reviewed_launcher" "$reviewed_composer" "$github_sha"; do digest "$value"; done
for file in "$policy" "$helper" "$launcher_source" "$composer" "$node" "$provenance" "$archive" "$gh"; do regular "$file"; done
[ "$(mode "$policy")" = 400 ] && [ "$(mode "$node")" = 500 ] && [ "$(mode "$provenance")" = 400 ] && [ "$(mode "$archive")" = 400 ] && [ "$(mode "$gh")" = 500 ] || refuse
[ "$(sha256 "$policy")" = "$reviewed_policy" ] && [ "$(sha256 "$helper")" = "$reviewed_helper" ] && [ "$(sha256 "$launcher_source")" = "$reviewed_launcher" ] && [ "$(sha256 "$composer")" = "$reviewed_composer" ] && [ "$(sha256 "$gh")" = "$github_sha" ] || refuse
node_sha=$(sha256 "$node"); [ "$(sha256 "$archive")" = "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" ] || refuse; archive_node_sha=$(/usr/bin/tar -xJOf "$archive" "$archive_member" 2>/dev/null | /usr/bin/shasum -a 256 | /usr/bin/awk 'NR==1 {print $1}') || refuse; [ "$archive_node_sha" = "$node_sha" ] || refuse; node_version_output=$(/usr/bin/env -i HOME="$HOME" PATH=/usr/bin:/bin "$node" --version 2>/dev/null) || refuse; [ "$(json_get "$provenance" schemaVersion)" = 1 ] && [ "$(json_get "$provenance" artifact)" = node ] && [ "$(json_get "$provenance" version)" = "$node_version" ] && [ "$(json_get "$provenance" archiveSha256)" = "$(json_get "$policy" supplyChain.node.ownerDarwinArm64Sha256)" ] && [ "$(json_get "$provenance" checksumSha256)" = "$(json_get "$policy" supplyChainProvenance.node.checksumsSha256)" ] && [ "$(json_get "$provenance" signatureSha256)" = "$(json_get "$policy" supplyChainProvenance.node.signatureSha256)" ] && [ "$(json_get "$provenance" keyringSha256)" = "$(json_get "$policy" supplyChainProvenance.node.keyringSha256)" ] && [ "$(json_get "$provenance" executableSha256)" = "$node_sha" ] && [ "$(json_get "$provenance" sha256)" = "$node_sha" ] && [ "$node_version_output" = "v$node_version" ] || refuse
if [ -e "$helper_copy" ] || [ -L "$helper_copy" ]; then
  regular "$helper_copy"
else
  /bin/cp -p -- "$helper" "$helper_copy"; /bin/chmod 0500 "$helper_copy"; regular "$helper_copy"
fi
[ "$(sha256 "$helper_copy")" = "$reviewed_helper" ] || refuse
[ ! -e "$launcher" ] && [ ! -L "$launcher" ] || refuse; /bin/cp -p -- "$launcher_source" "$launcher"; /bin/chmod 0400 "$launcher"; /bin/sync; regular "$launcher"; [ "$(sha256 "$launcher")" = "$reviewed_launcher" ] || refuse
[ "$(sha256 "$node")" = "$node_sha" ] && [ "$(sha256 "$provenance")" = "$(sha256 "$transaction_dir/prepared-node/node-provenance.json")" ] || refuse
exec /usr/bin/env -i HOME="$HOME" PATH=/usr/bin:/bin "$node" "$launcher" "$composer" "$reviewed_composer" "$gh" "$github_sha" "$source_root/../.." "$@"
