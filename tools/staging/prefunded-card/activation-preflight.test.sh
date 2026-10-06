#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
readonly SCRIPT="$ROOT/tools/staging/prefunded-card/activation-preflight.sh"
readonly CHECKSUMS="$ROOT/tools/staging/prefunded-card/activation-preflight.SHA256SUMS"
readonly DIAGNOSTIC_CHECKSUMS="$ROOT/tools/staging/prefunded-card/activation-owner-diagnostic.SHA256SUMS"

bash -n "$SCRIPT"
bash "$SCRIPT" --help | grep -Fq 'root-only read-only diagnostic'
shasum -a 256 -c "$CHECKSUMS" >/dev/null
(cd "$(dirname "$DIAGNOSTIC_CHECKSUMS")" && shasum -a 256 -c "$(basename "$DIAGNOSTIC_CHECKSUMS")") >/dev/null

if grep -Eq '\b(vercel|docker|curl|pnpm|psql)\b' "$SCRIPT"; then
  echo 'owner launcher must not perform deployment or database work' >&2
  exit 1
fi

grep -Fq 'ssh -tt' "$SCRIPT"
grep -Fq '/usr/bin/mktemp -d /tmp/baci-prefunded-card-owner-diagnostic.XXXXXXXX' "$SCRIPT"
grep -Fq 'sudo /usr/bin/mktemp -d /root/baci-prefunded-card-owner-diagnostic.XXXXXXXX' "$SCRIPT"
grep -Fq "printf '%s  %s" "$SCRIPT"
grep -Fq 'sha256sum -c -' "$SCRIPT"
grep -Fq 'activation-owner-diagnostic.SHA256SUMS' "$SCRIPT"

if grep -Fq 'scp "$HERE/$DIAGNOSTIC" "$HERE/$DIAGNOSTIC_CHECKSUMS"' "$SCRIPT"; then
  echo 'owner launcher must not use an uploaded manifest as root hash authority' >&2
  exit 1
fi

mock_bin="$(mktemp -d)"
trap 'rm -rf "$mock_bin"' EXIT
cat >"$mock_bin/scp" <<'MOCK_SCP'
#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]]
[[ "$1" == *'/activation-owner-diagnostic.py' ]]
[[ "$2" == 'bassey@82.29.190.219:/tmp/baci-prefunded-card-owner-diagnostic.12345678/activation-owner-diagnostic.py' ]]
MOCK_SCP
cat >"$mock_bin/ssh" <<'MOCK_SSH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == '-o' ]]; then
  cat >/dev/null
  printf '%s\n' '/tmp/baci-prefunded-card-owner-diagnostic.12345678'
  exit 0
fi

[[ $# -eq 3 ]]
[[ "$1" == '-tt' ]]
[[ "$2" == 'bassey@82.29.190.219' ]]
remote_invocation="$3"
eval "set -- $remote_invocation"
[[ $# -eq 4 ]]
[[ "$1" == '/usr/bin/env' ]]
[[ "$2" == 'bash' ]]
[[ "$3" == '-c' ]]
[[ "$4" == *"expected_sha="* ]]
[[ "$4" == *"sha256sum -c -"*"python3"* ]]
[[ "$4" != *'activation-owner-diagnostic.SHA256SUMS'* ]]
MOCK_SSH
chmod +x "$mock_bin/scp" "$mock_bin/ssh"
PATH="$mock_bin:$PATH" bash "$SCRIPT"
