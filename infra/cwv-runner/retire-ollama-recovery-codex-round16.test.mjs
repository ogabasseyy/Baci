import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

function recoveryScan(scenario, receipt) {
  return execFileAsync('sh', [
    '-c',
    `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_mutable_consumers() { : >"$1"; : >"$2"; RECOVERY_MUTABLE_MODEL='{}'; RECOVERY_MUTABLE_CRON='{}'; }; recovery_collect_container_consumers() { : >"$1"; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{}'; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { printf '%s\\n' '{"state":"absent"}'; }; recovery_terminal_process_snapshot() { :; }; recovery_terminal_container_snapshot() { :; }; recovery_terminal_mutable_consumers() { :; }; recovery_terminal_container_consumers() { :; }; recovery_package_snapshot() { printf '%s\\n' '{"name":"ollama","state":"absent","version":null}'; }; recovery_unit_snapshot() { printf '%s\\n' '{}'; }; socket_calls=0; record_docker_socket() { socket_calls=$((socket_calls + 1)); identity=socket-old; [ "$SCENARIO" != socket ] || [ "$socket_calls" -eq 1 ] || identity=socket-new; records=$(/usr/bin/jq -cn --argjson old "$records" --arg identity "$identity" '$old + [{class:"docker-socket",identitySha256:$identity}]'); }; daemon_calls=0; recovery_surface() { [ "$1" = docker-daemon ] || return 0; daemon_calls=$((daemon_calls + 1)); identity=daemon-old; [ "$SCENARIO" != daemon ] || [ "$daemon_calls" -eq 1 ] || identity=daemon-new; RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg identity "$identity" '$old + [{class:"docker-daemon",sha256:$identity}]'); }; recovery_write_receipt() { : >"$RECEIPT"; }; SCENARIO=$2; RECEIPT=$3; init_temp_root; recovery_scan`,
    'recovery-codex-round16-test',
    script.pathname,
    scenario,
    receipt,
  ]);
}

for (const scenario of ['socket', 'daemon']) {
  test(`refuses a terminal Docker ${scenario} identity replacement`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `baci-docker-${scenario}-`));
    const receipt = join(directory, 'receipt.json');
    try {
      await assert.rejects(
        recoveryScan(scenario, receipt),
        (error) =>
          error.code === 78 &&
          /recovery Docker identity changed before receipt publication/.test(
            error.stderr
          )
      );
      await assert.rejects(access(receipt));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
