import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const identifier = 'a'.repeat(64);
const stopped = {
  Config: { Env: ['A=B'] },
  HostConfig: { NetworkMode: 'bridge' },
  Id: identifier,
  Image: `sha256:${'b'.repeat(64)}`,
  Mounts: [],
  Name: '/ollama-loopback',
  NetworkSettings: { Networks: { bridge: {} } },
  Path: '/usr/bin/ollama',
  State: { Pid: 0, Running: false },
};
const running = {
  ...stopped,
  State: { Pid: 41, Running: true },
};

function terminalSnapshot(initial, final) {
  return execFileAsync('sh', [
    '-c',
    `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; init_temp_root; trap cleanup_temp EXIT; initial=$(temp_path); printf '%s' "$2" >"$initial"; config=$(temp_path); /usr/bin/jq -S -c '{Config,HostConfig,Mounts,Networks:.NetworkSettings.Networks}' "$initial" >"$config"; RECOVERY_CONTAINER_STATE=$(/usr/bin/jq -r 'if .State.Running then "running" else "stopped" end' "$initial"); RECOVERY_CONTAINER_ID=$(/usr/bin/jq -r .Id "$initial"); RECOVERY_CONTAINER_NAME=$(/usr/bin/jq -r .Name "$initial"); RECOVERY_CONTAINER_PID=$(/usr/bin/jq -r .State.Pid "$initial"); RECOVERY_CONTAINER_CONFIG_SHA=$(sha "$config"); recovery_docker() { [ "$1" = inspect ] || exit 79; printf '%s\\n' "$3"; }; recovery_terminal_container_snapshot`,
    'recovery-terminal-container-test',
    script.pathname,
    JSON.stringify(initial),
    JSON.stringify(final),
  ]);
}

test('rejects identity, name, config, state, and PID drift at terminal recheck', async () => {
  const cases = [
    ['ID', { ...stopped, Id: 'b'.repeat(64) }],
    ['name', { ...stopped, Name: '/changed' }],
    ['config', { ...stopped, Config: { Env: ['A=changed'] } }],
    ['stopped-to-running', running],
    ['running PID', { ...running, State: { Pid: 42, Running: true } }],
  ];
  for (const [name, final] of cases) {
    await assert.rejects(
      terminalSnapshot(name === 'running PID' ? running : stopped, final),
      (error) =>
        error.code === 78 &&
        /recovery container changed before receipt publication/.test(
          error.stderr
        )
    );
  }
});

test('does not publish a receipt when a stopped container becomes running', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-terminal-'));
  const receipt = join(directory, 'receipt.json');
  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_systemd() { :; }; recovery_surface() { :; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { /usr/bin/jq -cn '{state:"absent",matchingProcesses:[],listeningSockets:[],socketSnapshotSha256:"test"}'; }; recovery_collect_crontab() { : >"$1"; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); : >"$RECOVERY_EXTERNAL_CRON_SOURCES"; }; recovery_record_external_cron_sources() { :; }; recovery_package_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_unit_snapshot() { /usr/bin/jq -cn --arg name "$1" '{name:$name,state:"absent"}'; }; recovery_model_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_cron_snapshot() { /usr/bin/jq -cn '{wholeSha256:"test",lineCount:0,lines:[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; initial=$3; final=$4; calls=0; recovery_docker() { case "$1" in inspect) calls=$((calls + 1)); if [ "$calls" -eq 1 ]; then printf '%s\\n' "$initial"; else printf '%s\\n' "$final"; fi;; *) exit 79;; esac; }; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        'recovery-stopped-running-test',
        script.pathname,
        receipt,
        JSON.stringify(stopped),
        JSON.stringify(running),
      ]),
      (error) =>
        error.code === 78 &&
        /recovery container changed before receipt publication/.test(
          error.stderr
        )
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
