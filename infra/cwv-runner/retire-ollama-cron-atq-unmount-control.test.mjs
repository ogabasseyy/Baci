import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const childIdentity =
  process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};

async function preparePrivateDirectory(path) {
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined)
    await chown(path, childIdentity.uid, childIdentity.gid);
}

async function prepareWritableFile(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined)
    await chown(path, childIdentity.uid, childIdentity.gid);
}

test('unprivileged recovery can write the unmount targets when the scheduler is present', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-atq-present-recovery-'))
  );
  await chmod(directory, 0o711);
  const receiptDirectory = join(directory, 'receipts');
  const atJobs = join(directory, 'atjobs');
  const mountState = join(directory, 'mount-state');
  const unmounted = join(directory, 'unmounted');
  const atQuiescenceHelper = join(directory, 'retire-ollama-at-quiescence.sh');
  await Promise.all([preparePrivateDirectory(receiptDirectory), mkdir(atJobs)]);
  await Promise.all([
    prepareWritableFile(
      atQuiescenceHelper,
      await readFile(
        new URL('./retire-ollama-at-quiescence.sh', import.meta.url),
        'utf8'
      )
    ),
    writeFile(
      join(receiptDirectory, 'pre-destructive.json'),
      `${JSON.stringify({
        atSubmissionRollback: {
          path: atJobs,
          identity: '1:2:3:4',
          sequenceIdentity: '1:2:3:4',
          originalMountState: 'absent',
          quiescedMountState: 'ro-bind',
        },
      })}\n`,
      { mode: 0o644 }
    ),
    writeFile(
      join(receiptDirectory, 'pre-destructive.actions'),
      'quiesce_at_submissions\n',
      { mode: 0o644 }
    ),
    prepareWritableFile(mountState, 'rw\n'),
    prepareWritableFile(unmounted, 'not-yet\n'),
  ]);
  try {
    await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; RECEIPT_DIR=$2; AT_JOB_DIR=$3; MOUNT_STATE=$4; UNMOUNTED=$5
fsync_dir() { :; }; safe_file() { :; }; load_at_quiescence_helper
cron_inventory_at_scheduler_absent() { return 1; }
at_submission_mount_state() { cat "$MOUNT_STATE"; }
assert_at_submission_identity() { :; }
at_unmount_submission_spool() { printf 'unmounted\n' >"$UNMOUNTED"; printf 'absent\n' >"$MOUNT_STATE"; }
reconcile_interrupted_at_quiescence`,
        'retire-ollama-present-at-recovery-writable-test',
        script.pathname,
        receiptDirectory,
        atJobs,
        mountState,
        unmounted,
      ],
      {
        ...childIdentity,
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_AT_QUIESCENCE_HELPER: atQuiescenceHelper,
        },
      }
    );
    assert.equal(await readFile(unmounted, 'utf8'), 'unmounted\n');
    assert.equal(await readFile(mountState, 'utf8'), 'absent\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
