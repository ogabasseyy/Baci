import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-container-mounts.sh', import.meta.url);
const portableFileSizeStat = `stat() { for last do :; done; case "$*" in *'-c %s'*) if /usr/bin/stat --version >/dev/null 2>&1; then /usr/bin/stat -c '%s' "$last"; else /usr/bin/stat -f '%z' "$last"; fi;; *) /usr/bin/stat "$@";; esac; }`;

test('fails closed when a clean regular-file bind gains a marker after its first snapshot', async () => {
  const script = `
    . "$1"
    root=$(readlink -f "$(mktemp -d)"); trap 'rm -rf "$root"' EXIT HUP INT TERM
    source_file="$root/application.conf"; printf '%s\\n' clean >"$source_file"
    temp_path() { mktemp "$root/temp.XXXXXX"; }
    container_mounts_snapshot() { printf '[{"Type":"bind","Source":"%s","Destination":"/etc/application.conf"}]\\n' "$source_file" >"$2"; }
    consumer_matched_fingerprint() { return 1; }
    consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ]; }
    consumer_source_identity() { printf '%s\\n' stable-identity; }
    consumer_snapshot() { snapshot=$(temp_path); cp "$1" "$snapshot" || return 2; calls=$((calls + 1)); [ "$calls" -ne 1 ] || printf '%s\\n' 'upstream=http://127.0.0.1:11434' >"$1"; printf '%s|stable-identity\\n' "$snapshot"; }
    consumer_matches() { grep -Eqi 'ollama|11434' "$1"; }
    sha() { /usr/bin/shasum -a 256 "$1" | awk '{print $1}'; }
    docker() { case "$*" in *State.Running*) printf '%s\\n' false;; *) return 2;; esac; }
    CANONICAL_DOCKER_SOCKET=/run/docker.sock; calls=0
    if container_bind_mount_consumers container-id; then exit 1; else status=$?; fi
    [ "$status" -eq 2 ]
  `;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-file-stability-regression',
    helper.pathname,
  ]);
});

test('keeps a pipe-bearing regular-file bind path intact across deferred validation', async () => {
  const script = `
    . "$1"
    root=$(readlink -f "$(mktemp -d)"); trap 'rm -rf "$root"' EXIT HUP INT TERM
    source_file="$root/application|production.conf"; printf '%s\\n' clean >"$source_file"
    temp_path() { mktemp "$root/temp.XXXXXX"; }
    container_mounts_snapshot() { printf '[{"Type":"bind","Source":"%s","Destination":"/etc/application.conf"}]\\n' "$source_file" >"$2"; }
    consumer_matched_fingerprint() { return 1; }
    consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ]; }
    consumer_source_identity() { printf '%s\\n' stable-identity; }
    consumer_snapshot() { snapshot=$(temp_path); cp "$1" "$snapshot" || return 2; printf '%s|stable-identity\\n' "$snapshot"; }
    consumer_matches() { grep -Eqi 'ollama|11434' "$1"; }
    sha() { /usr/bin/shasum -a 256 "$1" | awk '{print $1}'; }
    ${portableFileSizeStat}
    docker() { case "$*" in *State.Running*) printf '%s\\n' false;; *) return 2;; esac; }
    CANONICAL_DOCKER_SOCKET=/run/docker.sock
    container_bind_mount_consumers container-id >/dev/null
  `;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-file-pipe-regression',
    helper.pathname,
  ]);
});

test('emits a consumer when a bind becomes matching at the first stable snapshot', async () => {
  const script = `
    . "$1"
    root=$(readlink -f "$(mktemp -d)"); trap 'rm -rf "$root"' EXIT HUP INT TERM
    source_file="$root/application.conf"; printf '%s\\n' clean >"$source_file"
    temp_path() { mktemp "$root/temp.XXXXXX"; }
    container_mounts_snapshot() { printf '[{"Type":"bind","Source":"%s","Destination":"/etc/application.conf"}]\\n' "$source_file" >"$2"; }
    consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ]; }
    consumer_source_identity() { printf '%s\\n' stable-identity; }
    consumer_snapshot() { calls=$((calls + 1)); [ "$calls" -ne 1 ] || printf '%s\\n' 'upstream=http://127.0.0.1:11434' >"$1"; snapshot=$(temp_path); cp "$1" "$snapshot" || return 2; printf '%s|stable-identity\\n' "$snapshot"; }
    consumer_matches() { grep -Eqi 'ollama|11434' "$1"; }
    sha() { /usr/bin/shasum -a 256 "$1" | awk '{print $1}'; }
    ${portableFileSizeStat}
    docker() { case "$*" in *State.Running*) printf '%s\\n' false;; *) return 2;; esac; }
    CANONICAL_DOCKER_SOCKET=/run/docker.sock; calls=0
    container_bind_mount_consumers container-id | grep -q '^container-bind-mount:'
  `;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-file-new-match-regression',
    helper.pathname,
  ]);
});
