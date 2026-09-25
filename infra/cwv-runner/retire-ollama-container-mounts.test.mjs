import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-container-mounts.sh', import.meta.url);
const portableFileSizeStat = `stat() { for last do :; done; case "$*" in *'-c %s'*) if /usr/bin/stat --version >/dev/null 2>&1; then /usr/bin/stat -c '%s' "$last"; else /usr/bin/stat -f '%z' "$last"; fi;; *) /usr/bin/stat "$@";; esac; }`;

test('accepts only canonical Docker socket source and destination paths', async () => {
  const script = `
. "$1"
CANONICAL_DOCKER_SOCKET=/run/docker.sock
test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0;; *) return 1;; esac; fi; /usr/bin/test "$@"; }
readlink() { [ "$1" = -f ] || return 2; path=$2; [ "$path" = -- ] && path=$3; case "$path" in /run/docker.sock|/var/run/docker.sock) printf '/run/docker.sock\\n' ;; *) return 1 ;; esac; }
stat() { case "$*" in *'%u:%a'*'/run/docker.sock'|*'%u:%a'*'/var/run/docker.sock') printf '0:660\\n' ;; *'/run/docker.sock'|*'/var/run/docker.sock') printf '1:2:14000:0:999:660\\n' ;; *) return 1 ;; esac; }
container_docker_socket_source_is_canonical /run/docker.sock || exit 1
container_docker_socket_source_is_canonical /var/run/docker.sock || exit 1
container_docker_socket_destination_is_canonical /var/run/docker.sock || exit 1
if container_docker_socket_source_is_canonical /tmp/docker.sock; then exit 1; fi
if container_docker_socket_destination_is_canonical /run/docker.sock/../escape; then exit 1; fi
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-test',
    helper.pathname,
  ]);
});

test('rejects a canonical socket source substituted before finalization', async () => {
  const script = `
. "$1"
CANONICAL_DOCKER_SOCKET=/run/docker.sock
test() { if [ "$1" = -S ]; then case "$2" in /run/docker.sock|/var/run/docker.sock) return 0;; *) return 1;; esac; fi; /usr/bin/test "$@"; }
stat() { case "$*" in *'%u:%a'*'/run/docker.sock'|*'%u:%a'*'/var/run/docker.sock') printf '0:660\\n' ;; *'/run/docker.sock'|*'/var/run/docker.sock') printf '1:2:14000:0:999:660\\n' ;; *) return 1 ;; esac; }
marker=$(mktemp)
readlink() { [ "$1" = -f ] || return 2; path=$2; [ "$path" = -- ] && path=$3; calls=$(cat "$marker"); calls=$((calls + 1)); printf '%s' "$calls" >"$marker"; if [ "$calls" -le 2 ]; then printf '/run/docker.sock\\n'; else printf '/tmp/substituted.sock\\n'; fi; }
temp_path() { mktemp; }
container_mounts_snapshot() { printf '[{"Type":"bind","Source":"/var/run/docker.sock","Destination":"/var/run/docker.sock"}]\\n' >"$2"; }
docker() { case "$*" in *State.Running*) printf 'true\\n' ;; *) return 2 ;; esac; }
hash_text() { printf '%064d\\n' 0; }
if container_bind_mount_consumers container-id; then exit 1; fi
rm -f "$marker"
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-substitution-test',
    helper.pathname,
  ]);
});

test('cleans parsed mount paths when evidence temp initialization fails', async () => {
  const script = `
set -e
. "$1"
test_root=$(mktemp -d)
calls_file="$test_root/calls"
: >"$calls_file"
cleanup() { rm -rf "$test_root"; }
trap cleanup EXIT HUP INT TERM
temp_path() {
  calls=$(cat "$calls_file")
  calls=$((calls + 1))
  printf '%s' "$calls" >"$calls_file"
  case "$calls" in
    1|2|3) temp_path_value="$test_root/path.$calls"; : >"$temp_path_value";;
    4) temp_path_value="$test_root/evidence-directory"; mkdir "$temp_path_value";;
    *) return 2;;
  esac
  printf '%s\\n' "$temp_path_value"
}
container_mounts_snapshot() { printf '[]\\n' >"$2"; }
docker() { case "$*" in *State.Running*) printf 'false\\n';; *) return 2;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
mount_status=0
container_bind_mount_consumers container-id || mount_status=$?
[ "$mount_status" -eq 2 ] || exit 1
[ ! -e "$test_root/path.1" ] || exit 2
[ ! -e "$test_root/path.2" ] || exit 3
[ ! -e "$test_root/path.3" ] || exit 4
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-cleanup-test',
    helper.pathname,
  ]);
});

test('fails closed for running or transitioning tmpfs mounts in the direct helper', async () => {
  const script = `
. "$1"
temp_path() { mktemp; }
container_mounts_snapshot() { printf '[{"Type":"tmpfs","Name":"","Source":"","Destination":"/tmp/cache","Driver":"","Mode":"","RW":true,"Propagation":""}]\\n' >"$2"; }
hash_text() { /usr/bin/printf '%s\\n' "$1" | /usr/bin/shasum -a 256 | cut -d ' ' -f 1; }
state_mode=$2
state_marker=$(mktemp)
: >"$state_marker"
note_file=$(mktemp)
cleanup() { rm -f "$state_marker" "$note_file"; }
trap cleanup EXIT HUP INT TERM
container_scan_note_failure() { printf '%s\\n' "$2" >"$note_file"; }
docker() {
  case "$*" in
    *State.Running*)
      state_calls=$(cat "$state_marker")
      state_calls=$((state_calls + 1))
      printf '%s' "$state_calls" >"$state_marker"
      case "$state_mode:$state_calls" in invalid:*) printf 'maybe\\n' ;; transition:1|transition:2) printf 'false\\n' ;; *) printf 'true\\n' ;; esac
      ;;
    *) return 2 ;;
  esac
}
CANONICAL_DOCKER_SOCKET=/run/docker.sock
if container_bind_mount_consumers container-id; then exit 1; fi
if [ "$state_mode" = transition ]; then grep -Fx tmpfs-mount "$note_file" >/dev/null || exit 1; fi
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-direct-test',
    helper.pathname,
    'invalid',
  ]);
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-direct-test',
    helper.pathname,
    'transition',
  ]);
});

test('reports bind-mounts when a bind mount changes during validation', async () => {
  const script = `
. "$1"
${portableFileSizeStat}
temp_path() { mktemp; }
bind_source=$(mktemp)
bind_source=$(readlink -f -- "$bind_source")
container_mounts_snapshot() { printf '[{"Type":"bind","Source":"%s","Destination":"/private/tmp/bind-target"}]\\n' "$bind_source" >"$2"; }
consumer_matched_fingerprint() { return 1; }
state_marker=$(mktemp)
: >"$state_marker"
note_file=$(mktemp)
cleanup() { rm -f "$bind_source" "$note_file" "$state_marker"; }
trap cleanup EXIT HUP INT TERM
container_scan_note_failure() { printf '%s\\n' "$2" >"$note_file"; }
docker() { case "$*" in *State.Running*) calls=$(cat "$state_marker"); calls=$((calls + 1)); printf '%s' "$calls" >"$state_marker"; [ "$calls" -le 2 ] && printf 'true\\n' || printf 'false\\n';; *) return 2;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
if container_bind_mount_consumers container-id; then exit 1; fi
grep -Fx bind-mounts "$note_file" >/dev/null || exit 1
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-bind-churn-test',
    helper.pathname,
  ]);
});

test('rejects an oversized single-file bind before snapshotting it', async () => {
  const script = `
. "$1"
temp_path() { mktemp; }
bind_source=$(mktemp)
bind_source=$(readlink -f -- "$bind_source")
container_mounts_snapshot() { printf '[{"Type":"bind","Source":"%s","Destination":"/tmp/bind-target"}]\\n' "$bind_source" >"$2"; }
stat() { case "$*" in *'-c %s'*"$bind_source") printf '67108865\\n';; *) /usr/bin/stat "$@";; esac; }
snapshot_marker=$(mktemp)
consumer_matched_fingerprint() { : >"$snapshot_marker"; return 1; }
docker() { case "$*" in *State.Running*) printf 'false\\n';; *) return 2;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
set +e
container_bind_mount_consumers container-id
status=$?
set -e
[ "$status" -eq 2 ] || exit 1
[ ! -s "$snapshot_marker" ] || exit 2
rm -f "$bind_source" "$snapshot_marker"
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-single-file-bound-test',
    helper.pathname,
  ]);
});

test('reports volume-snapshot when a volume changes during validation', async () => {
  const script = `
. "$1"
temp_path() { mktemp; }
container_mounts_snapshot() { printf '[{"Type":"volume","Name":"retire-volume","Source":"/tmp/retire-volume","Destination":"/tmp/volume-target","Driver":"local","Mode":"","RW":true,"Propagation":""}]\\n' >"$2"; }
container_volume_consumers() { :; }
state_marker=$(mktemp)
: >"$state_marker"
note_file=$(mktemp)
container_scan_note_failure() { printf '%s\\n' "$2" >"$note_file"; }
docker() { case "$*" in *State.Running*) calls=$(cat "$state_marker"); calls=$((calls + 1)); printf '%s' "$calls" >"$state_marker"; [ "$calls" -le 2 ] && printf 'true\\n' || printf 'false\\n';; *) return 2;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
if container_bind_mount_consumers container-id; then exit 1; fi
grep -Fx volume-snapshot "$note_file" >/dev/null || exit 1
rm -f "$note_file" "$state_marker"
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-volume-churn-test',
    helper.pathname,
  ]);
});

test('preserves outer mount snapshots across nested volume consumer globals', async () => {
  const script = `
. "$1"
${portableFileSizeStat}
test_root=$(mktemp -d)
temp_path() {
  temp_path_value=$(mktemp "$test_root/path.XXXXXX") || exit 2
  printf '%s\\n' "$temp_path_value" >>"$test_root/paths" || exit 2
  printf '%s\\n' "$temp_path_value"
}
bind_source=$(mktemp)
bind_source=$(readlink -f -- "$bind_source")
container_mounts_snapshot() {
  printf '[{"Type":"volume","Name":"retire-volume","Source":"/tmp/retire-volume","Destination":"/tmp/volume-target","Driver":"local","Mode":"","RW":true,"Propagation":""},{"Type":"bind","Source":"%s","Destination":"/tmp/bind-target"}]\\n' "$bind_source" >"$2"
}
container_volume_consumers() {
  id=clobbered-id
  paths="$test_root/clobbered-paths"
  first="$test_root/clobbered-first"
  : >"$paths" && : >"$first"
}
consumer_matched_fingerprint() { return 1; }
docker() { case "$*" in *State.Running*) printf 'false\\n' ;; *) return 2 ;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
container_bind_mount_consumers container-id || exit 3
while IFS= read -r path || [ -n "$path" ]; do
  [ ! -e "$path" ] || exit 4
done <"$test_root/paths"
rm -rf "$test_root" "$bind_source"
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-nested-state-test',
    helper.pathname,
  ]);
});

test('keeps mount records isolated when a mount consumer reads stdin', async () => {
  const script = `
exec </dev/null
. "$1"
${portableFileSizeStat}
test_root=$(mktemp -d)
bind_source="$test_root/bind-source"
consumed_file="$test_root/consumed"
validated_file="$test_root/validated"
: >"$bind_source"
bind_source=$(readlink -f -- "$bind_source")
cleanup() { rm -rf "$test_root"; }
trap cleanup EXIT HUP INT TERM
temp_path() { mktemp; }
container_mounts_snapshot() {
  printf '[{"Type":"volume","Name":"retire-volume","Source":"/tmp/retire-volume","Destination":"/tmp/volume-target","Driver":"local","Mode":"","RW":true,"Propagation":""},{"Type":"bind","Source":"%s","Destination":"/tmp/bind-target"}]\\n' "$bind_source" >"$2"
}
container_volume_consumers() {
  consumed_line=''
  IFS= read -r consumed_line || consumed_line='stdin-eof'
  printf '%s\\n' "$consumed_line" >"$consumed_file"
}
consumer_snapshot() {
  printf '%s\\n' "$1" >"$validated_file"
  snapshot=$(temp_path)
  cp "$1" "$snapshot" || return 2
  printf '%s|stable-identity\\n' "$snapshot"
}
consumer_matches() { return 1; }
consumer_canonical_regular() { [ -f "$1" ] && [ ! -L "$1" ]; }
consumer_source_identity() { printf '%s\\n' stable-identity; }
sha() { /usr/bin/shasum -a 256 "$1" | awk '{print $1}'; }
docker() { case "$*" in *State.Running*) printf 'false\\n';; *) return 2;; esac; }
CANONICAL_DOCKER_SOCKET=/run/docker.sock
container_bind_mount_consumers container-id || exit 3
grep -Fx "$bind_source" "$validated_file" >/dev/null || exit 4
grep -Fx stdin-eof "$consumed_file" >/dev/null || exit 5
`;
  await execFileAsync('sh', [
    '-c',
    script,
    'container-mounts-stdin-isolation-test',
    helper.pathname,
  ]);
});

assert.ok(helper.pathname.endsWith('retire-ollama-container-mounts.sh'));
