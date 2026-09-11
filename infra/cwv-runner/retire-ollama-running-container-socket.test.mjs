import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('rejects a running-container socket source substituted during finalization', async () => {
  const shell = `
. "$1"
SCRIPT_DIR=$(dirname "$1")
load_consumer_scanners
temp_path() { mktemp; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0;; *) return 1;; esac; fi; /usr/bin/test "$@"; }
stat() { case "$*" in *'%u:%a'*/run/docker.sock|*'%u:%a'*/var/run/docker.sock) printf '0:660\\n';; */run/docker.sock|*/var/run/docker.sock) printf '1:2:14000:0:999:660\\n';; *) return 1;; esac; }
marker=$(mktemp)
trap 'rm -f "$marker"' EXIT
readlink() { [ "$1" = -f ] || return 2; path=$2; [ "$path" = -- ] && path=$3; calls=$(cat "$marker"); calls=$((calls + 1)); printf '%s' "$calls" >"$marker"; [ "$calls" -le 2 ] && printf '/run/docker.sock\\n' || printf '/tmp/substituted.sock\\n'; }
docker() { case "$*" in *'{{json .Mounts}} generic-api'*) printf '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]\\n';; *) return 2;; esac; }
if running_container_socket_env_matches generic-api /var/run/docker.sock; then exit 1; fi
calls=$(cat "$marker")
[ "$calls" -eq 3 ] || { printf 'unexpected readlink invocation count: %s\\n' "$calls" >&2; exit 1; }
`;
  await execFileAsync('sh', [
    '-c',
    shell,
    'running-container-socket-substitution-test',
    script.pathname,
  ]);
});

assert.ok(script.pathname.endsWith('retire-ollama.sh'));
