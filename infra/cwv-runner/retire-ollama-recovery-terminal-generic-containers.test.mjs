import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('refuses a stopped generic container created after the initial container scans', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-cwv-late-container-'));
  const receipt = join(directory, 'receipt.json');
  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; root() { :; }; assert_docker_socket() { CANONICAL_DOCKER_SOCKET=/run/docker.sock; }; recovery_source_identity() { :; }; recovery_collect_systemd() { :; }; definition_calls=0; recovery_surface() { class=$1; value=stable; count=0; case "$class" in container-definitions) definition_calls=$((definition_calls + 1)); if [ "$definition_calls" -gt 1 ]; then value=late-stopped-container; count=1; fi;; esac; RECOVERY_RECORDS=$(/usr/bin/jq -cn --argjson old "$RECOVERY_RECORDS" --arg class "$class" --arg value "$value" '$old + [{class:$class,sha256:$value}]'); consumer_counts=$(/usr/bin/jq -cn --argjson old "$consumer_counts" --arg surface "$class" --argjson count "$count" '$old + [{surface:$surface,matchCount:$count}]'); if [ "$count" -eq 1 ]; then deps=$(/usr/bin/jq -cn --argjson old "$deps" '$old + [{"key-name":"container-definitions:1","endpoint-class":"unknown","normalized-value-sha256":"a","source-path-sha256":"b",disposition:"consumer"}]'); consumer_evidence=$(/usr/bin/jq -cn --argjson old "$consumer_evidence" '$old + [{surface:"container-definitions",classifiedPathSha256:"b"}]'); fi; }; recovery_container_snapshot() { RECOVERY_CONTAINER_STATE=absent; printf '%s\\n' '{"name":"ollama-loopback","state":"absent"}'; }; recovery_collect_processes() { : >"$1"; }; recovery_absent_process_snapshot() { /usr/bin/jq -cn '{state:"absent",matchingProcesses:[],listeningSockets:[],socketSnapshotSha256:"stable"}'; }; recovery_terminal_process_snapshot() { :; }; recovery_terminal_container_snapshot() { :; }; recovery_collect_crontab() { : >"$1"; RECOVERY_EXTERNAL_CRON_SOURCES=$(temp_path); : >"$RECOVERY_EXTERNAL_CRON_SOURCES"; }; recovery_record_external_cron_sources() { :; }; recovery_package_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_unit_snapshot() { /usr/bin/jq -cn --arg name "$1" '{name:$name,state:"absent"}'; }; recovery_model_snapshot() { /usr/bin/jq -cn '{state:"absent"}'; }; recovery_cron_snapshot() { /usr/bin/jq -cn '{wholeSha256:"stable",lineCount:0,lines:[]}'; }; record_docker_socket() { :; }; recovery_write_receipt() { : >"$RECEIPT_MARKER"; }; RECEIPT_MARKER=$2; init_temp_root; recovery_scan`,
        'recovery-late-generic-container-test',
        script.pathname,
        receipt,
      ]),
      (error) =>
        error.code === 78 &&
        /recovery container consumer inventory changed before receipt publication/.test(
          error.stderr
        )
    );
    await assert.rejects(access(receipt));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
