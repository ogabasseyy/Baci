import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('refuses an ollama-loopback created after the initial absent inventory', async () => {
  const id = 'a'.repeat(64);
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; calls=0; recovery_docker() { case "$1" in inspect) printf 'Error: No such object: ollama-loopback\\n' >&2; return 1;; ps) calls=$((calls + 1)); [ "$calls" -eq 1 ] || printf '${id} ollama-loopback\\n';; *) exit 79;; esac; }; init_temp_root; trap cleanup_temp EXIT; recovery_container_snapshot`,
      'recovery-absence-stability-test',
      script.pathname,
    ]),
    (error) =>
      error.code === 78 &&
      /recovery container changed during absence verification/.test(
        error.stderr
      )
  );
});

test('refuses a container created after both absence inventories before publishing a receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-recovery-'));
  const receipt = join(directory, 'receipt.json');
  try {
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_systemd() { :; }; recovery_surface() { :; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { /usr/bin/jq -cn '{state:"absent",matchingProcesses:[],listeningSockets:[],socketSnapshotSha256:"test"}'; }; recovery_collect_crontab() { : >"$1"; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); : >"$RECOVERY_EXTERNAL_CRON_SOURCES"; }; recovery_record_external_cron_sources() { :; }; recovery_package_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_unit_snapshot() { /usr/bin/jq -cn --arg name "$1" '{name:$name,state:"absent"}'; }; recovery_model_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_cron_snapshot() { /usr/bin/jq -cn '{wholeSha256:"test",lineCount:0,lines:[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; calls=0; recovery_docker() { case "$1" in inspect) calls=$((calls + 1)); if [ "$calls" -eq 1 ]; then printf 'Error: No such object: ollama-loopback\\n' >&2; return 1; fi; printf 'new-container\\n';; ps) :;; *) exit 79;; esac; }; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        'recovery-terminal-absence-test',
        script.pathname,
        receipt,
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
