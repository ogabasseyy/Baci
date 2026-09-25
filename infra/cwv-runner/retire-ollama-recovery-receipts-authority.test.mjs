import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

function shell(env = {}, options = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      '. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; id() { printf "%s\\n" "$RETIRE_OLLAMA_TEST_FAKE_UID"; }; sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk "{print \\$1}"; }; init_temp_root; trap cleanup_temp EXIT; recovery_source_digests; printf "%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s:%s\\n" "$RECOVERY_SCRIPT_SHA" "$RECOVERY_HELPER_SHA" "$RECOVERY_RECEIPTS_SHA" "$RECOVERY_CONSUMERS_SHA" "$RECOVERY_CONSUMER_MOUNTS_SHA" "$RECOVERY_RUNNING_CONTAINER_SHA" "$RECOVERY_RUNNING_ARCHIVE_SHA" "$RECOVERY_CONSUMER_CLOSURE_SHA" "$RECOVERY_PROCESS_FILES_SHA" "$RECOVERY_CRON_INVENTORY_SHA" "$RECOVERY_AT_QUIESCENCE_SHA" "$RECOVERY_IMAGE_FILESYSTEM_SHA" "$RECOVERY_TEMP_ROOT_SHA" "$RECOVERY_PROJECTOR_AUTH_SHA"',
      'recovery-receipts-authority-test',
      script.pathname,
    ],
    { ...options, env: { ...process.env, ...env } }
  );
}

async function sha256(file) {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
}

test('derives recovery source digests from sealed files for privileged execution', async () => {
  const overrides = {
    RECOVERY_HELPER_SHA: 'b'.repeat(64),
    RECOVERY_CONSUMERS_SHA: 'd'.repeat(64),
    RECOVERY_CONSUMER_MOUNTS_SHA: '5'.repeat(64),
    RECOVERY_IMAGE_FILESYSTEM_SHA: '6'.repeat(64),
    RECOVERY_TEMP_ROOT_SHA: '7'.repeat(64),
    RECOVERY_RUNNING_CONTAINER_SHA: '3'.repeat(64),
    RECOVERY_RUNNING_ARCHIVE_SHA: '4'.repeat(64),
    RECOVERY_CONSUMER_CLOSURE_SHA: 'f'.repeat(64),
    RECOVERY_PROCESS_FILES_SHA: '1'.repeat(64),
    RECOVERY_CRON_INVENTORY_SHA: 'e'.repeat(64),
    RECOVERY_RECEIPTS_SHA: 'c'.repeat(64),
    RECOVERY_SCRIPT_SHA: 'a'.repeat(64),
    RECOVERY_AT_QUIESCENCE_SHA: '2'.repeat(64),
    RECOVERY_PROJECTOR_AUTH_SHA: '8'.repeat(64),
    RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
    RETIRE_OLLAMA_TEST_FAKE_UID: '0',
  };
  const expected = await Promise.all([
    sha256(script),
    sha256(new URL('./retire-ollama-recovery.sh', script)),
    sha256(new URL('./retire-ollama-recovery-receipts.sh', script)),
    sha256(new URL('./retire-ollama-consumers.sh', script)),
    sha256(new URL('./retire-ollama-container-mounts.sh', script)),
    sha256(new URL('./retire-ollama-running-container.sh', script)),
    sha256(new URL('./retire-ollama-running-archive.sh', script)),
    sha256(new URL('./retire-ollama-consumer-closure.sh', script)),
    sha256(new URL('./retire-ollama-process-files.sh', script)),
    sha256(new URL('./retire-ollama-cron-inventory.sh', script)),
    sha256(new URL('./retire-ollama-at-quiescence.sh', script)),
    sha256(new URL('./retire-ollama-image-filesystem.pl', script)),
    sha256(new URL('./retire-ollama-temp-root.sh', script)),
    sha256(new URL('./retire-ollama-projector-auth.sh', script)),
  ]);
  const { stdout } = await shell(overrides);
  assert.deepEqual(stdout.trim().split(':'), expected);
});

test('permits digest overrides only in the unprivileged test harness', async () => {
  const overrides = {
    RECOVERY_HELPER_SHA: 'b'.repeat(64),
    RECOVERY_CONSUMERS_SHA: 'd'.repeat(64),
    RECOVERY_CONSUMER_MOUNTS_SHA: '5'.repeat(64),
    RECOVERY_IMAGE_FILESYSTEM_SHA: '6'.repeat(64),
    RECOVERY_TEMP_ROOT_SHA: '7'.repeat(64),
    RECOVERY_RUNNING_CONTAINER_SHA: '3'.repeat(64),
    RECOVERY_RUNNING_ARCHIVE_SHA: '4'.repeat(64),
    RECOVERY_CONSUMER_CLOSURE_SHA: 'f'.repeat(64),
    RECOVERY_PROCESS_FILES_SHA: '1'.repeat(64),
    RECOVERY_CRON_INVENTORY_SHA: 'e'.repeat(64),
    RECOVERY_RECEIPTS_SHA: 'c'.repeat(64),
    RECOVERY_SCRIPT_SHA: 'a'.repeat(64),
    RECOVERY_AT_QUIESCENCE_SHA: '2'.repeat(64),
    RECOVERY_PROJECTOR_AUTH_SHA: '8'.repeat(64),
    RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
    RETIRE_OLLAMA_TEST_FAKE_UID: '65534',
  };
  const { stdout } = await shell(overrides);
  assert.deepEqual(stdout.trim().split(':'), [
    overrides.RECOVERY_SCRIPT_SHA,
    overrides.RECOVERY_HELPER_SHA,
    overrides.RECOVERY_RECEIPTS_SHA,
    overrides.RECOVERY_CONSUMERS_SHA,
    overrides.RECOVERY_CONSUMER_MOUNTS_SHA,
    overrides.RECOVERY_RUNNING_CONTAINER_SHA,
    overrides.RECOVERY_RUNNING_ARCHIVE_SHA,
    overrides.RECOVERY_CONSUMER_CLOSURE_SHA,
    overrides.RECOVERY_PROCESS_FILES_SHA,
    overrides.RECOVERY_CRON_INVENTORY_SHA,
    overrides.RECOVERY_AT_QUIESCENCE_SHA,
    overrides.RECOVERY_IMAGE_FILESYSTEM_SHA,
    overrides.RECOVERY_TEMP_ROOT_SHA,
    overrides.RECOVERY_PROJECTOR_AUTH_SHA,
  ]);
});

test('rejects recovery when the loaded projector helper digest is stale', async () => {
  await assert.rejects(
    shell({
      RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
      RETIRE_OLLAMA_TEST_FAKE_UID: '65534',
      PROJECTOR_AUTH_HELPER_SHA: '0'.repeat(64),
    }),
    (error) => error.code === 1
  );
});
