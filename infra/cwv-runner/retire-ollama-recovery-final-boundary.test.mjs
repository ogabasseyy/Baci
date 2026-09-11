import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const modelSnapshotCommand = `readlink() { [ "$1" = -f ] && { [ "$2" = -- ] && printf '%s\\n' "$3" || printf '%s\\n' "$2"; return; }; /usr/bin/readlink "$@"; }; stat() { printf '1:2:0:0:700\\n'; }; findmnt() { printf '/ model ext4 ro\\n'; }; find() { case " $* " in *" ! -type f "*) printf 'd:700:0:0:%s\\n' "$STORE";; *) digest=$(sha256sum "$STORE/blob" | /usr/bin/awk '{print $1}') || return 1; printf 'f:600:4:0:%s:%s  %s\\n' "$STORE/blob" "$digest" "$STORE/blob";; esac; }; STORE="$2"; init_temp_root; trap cleanup_temp EXIT; recovery_model_snapshot`;

function shell(command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; ${command}`,
      'recovery-final-boundary-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  );
}

test('refuses a process and socket inventory that changes before receipt publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-final-process-'));
  const receipt = join(directory, 'receipt.json');
  try {
    await assert.rejects(
      shell(
        `root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_systemd() { :; }; recovery_surface() { :; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{"name":"ollama-loopback","state":"absent"}'; }; recovery_docker() { [ "$1" = inspect ] || exit 79; printf 'Error: No such object: ollama-loopback\\n' >&2; return 1; }; calls=0; recovery_ps() { calls=$((calls + 1)); [ "$calls" -eq 1 ] || printf '41 1 /usr/bin/ollama serve\\n'; }; recovery_absent_process_snapshot() { if grep -q ollama "$1"; then /usr/bin/jq -cn '{state:"absent",matchingProcesses:[{pid:"41"}],listeningSockets:[{inode:"9"}],socketSnapshotSha256:"second"}'; else /usr/bin/jq -cn '{state:"absent",matchingProcesses:[],listeningSockets:[],socketSnapshotSha256:"first"}'; fi; }; recovery_collect_crontab() { : >"$1"; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); : >"$RECOVERY_EXTERNAL_CRON_SOURCES"; }; recovery_record_external_cron_sources() { :; }; recovery_package_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_unit_snapshot() { /usr/bin/jq -cn --arg name "$1" '{name:$name,state:"absent"}'; }; recovery_model_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_cron_snapshot() { /usr/bin/jq -cn '{wholeSha256:"test",lineCount:0,lines:[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        [receipt]
      ),
      (error) =>
        error.code === 78 &&
        /recovery process or socket inventory changed before receipt publication/.test(
          error.stderr
        )
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a Compose definition added after the initial consumer scan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-final-compose-'));
  const receipt = join(directory, 'receipt.json');
  try {
    await assert.rejects(
      shell(
        `root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_systemd() { :; }; compose_calls=0; recovery_surface() { class=$1; case "$class" in compose-definitions) compose_calls=$((compose_calls + 1)); value=before; [ "$compose_calls" -eq 1 ] || value=late-definition;; *) value=stable;; esac; RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "$class" --arg value "$value" '$old + [{class:$class,sha256:$value}]'); }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{"name":"ollama-loopback","state":"absent"}'; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { /usr/bin/jq -cn '{state:"absent",matchingProcesses:[],listeningSockets:[],socketSnapshotSha256:"stable"}'; }; recovery_terminal_process_snapshot() { :; }; recovery_terminal_container_snapshot() { :; }; recovery_collect_crontab() { : >"$1"; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); : >"$RECOVERY_EXTERNAL_CRON_SOURCES"; }; recovery_record_external_cron_sources() { :; }; recovery_package_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_unit_snapshot() { /usr/bin/jq -cn --arg name "$1" '{name:$name,state:"absent"}'; }; recovery_model_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_cron_snapshot() { /usr/bin/jq -cn '{wholeSha256:"stable",lineCount:0,lines:[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        [receipt]
      ),
      (error) =>
        error.code === 78 &&
        /recovery mutable consumer inventory changed before receipt publication/.test(
          error.stderr
        )
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses package drift before immutable receipt publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-final-package-'));
  const receipt = join(directory, 'receipt.json');
  const packageMarker = join(directory, 'package-observed');
  try {
    await assert.rejects(
      shell(
        `root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_mutable_consumers() { : >"$1"; : >"$2"; RECOVERY_MUTABLE_MODEL='{}'; RECOVERY_MUTABLE_CRON='{}'; }; recovery_collect_container_consumers() { : >"$1"; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{}'; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { printf '%s\\n' '{"state":"absent"}'; }; recovery_terminal_process_snapshot() { :; }; recovery_terminal_container_snapshot() { :; }; recovery_terminal_mutable_consumers() { :; }; recovery_terminal_container_consumers() { :; }; recovery_package_snapshot() { if [ -e "$PACKAGE_MARKER" ]; then printf '%s\\n' '{"name":"ollama","state":"present","version":"1.0"}'; else : >"$PACKAGE_MARKER"; printf '%s\\n' '{"name":"ollama","state":"absent","version":null}'; fi; }; recovery_unit_snapshot() { printf '%s\\n' '{}'; }; record_docker_socket() { :; }; recovery_surface() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; PACKAGE_MARKER=$3; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        [receipt, packageMarker]
      ),
      (error) =>
        error.code === 78 &&
        /recovery package changed before receipt publication/.test(error.stderr)
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses unit enablement drift before immutable receipt publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-final-unit-'));
  const receipt = join(directory, 'receipt.json');
  const unitMarker = join(directory, 'unit-observed');
  try {
    await assert.rejects(
      shell(
        `root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_mutable_consumers() { : >"$1"; : >"$2"; RECOVERY_MUTABLE_MODEL='{}'; RECOVERY_MUTABLE_CRON='{}'; }; recovery_collect_container_consumers() { : >"$1"; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{}'; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { printf '%s\\n' '{"state":"absent"}'; }; recovery_terminal_process_snapshot() { :; }; recovery_terminal_container_snapshot() { :; }; recovery_terminal_mutable_consumers() { :; }; recovery_terminal_container_consumers() { :; }; recovery_package_snapshot() { printf '%s\\n' '{"name":"ollama","state":"absent","version":null}'; }; recovery_unit_snapshot() { if [ "$1" = "$UNIT" ]; then if [ -e "$UNIT_MARKER" ]; then printf '%s\\n' '{"name":"ollama.service","state":"present","loadState":"loaded","unitFileState":"enabled","activeState":"inactive","stateSha256":"changed"}'; else : >"$UNIT_MARKER"; printf '%s\\n' '{"name":"ollama.service","state":"absent"}'; fi; else printf '%s\\n' '{"name":"ollama-watchdog.timer","state":"absent"}'; fi; }; record_docker_socket() { :; }; recovery_surface() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; UNIT_MARKER=$3; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        [receipt, unitMarker]
      ),
      (error) =>
        error.code === 78 &&
        /recovery unit state changed before receipt publication/.test(
          error.stderr
        )
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('changes the model tree identity when same-size content is restored to its mtime', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-model-tree-'));
  const store = join(directory, 'store');
  const blob = join(store, 'blob');
  try {
    await mkdir(store);
    await writeFile(blob, 'aaaa');
    const before = await stat(blob);
    const initial = JSON.parse(
      (await shell(modelSnapshotCommand, [store])).stdout
    );
    await writeFile(blob, 'bbbb');
    await utimes(blob, before.atime, before.mtime);
    const final = JSON.parse(
      (await shell(modelSnapshotCommand, [store])).stdout
    );
    assert.notEqual(initial.treeSha256, final.treeSha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
