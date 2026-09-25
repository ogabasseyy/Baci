import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
  copyFile,
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

async function stageAtHelpers(directory) {
  const staged = join(directory, 'helpers');
  await mkdir(staged, { mode: 0o755 });
  for (const name of [
    'retire-ollama-at-quiescence.sh',
    'retire-ollama-cron-inventory.sh',
    'retire-ollama-source-loader.sh',
  ]) {
    const destination = join(staged, name);
    await copyFile(new URL(`./${name}`, import.meta.url), destination);
    await chmod(destination, 0o755);
  }
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined) {
    await chown(staged, childIdentity.uid, childIdentity.gid);
  }
  return staged;
}

async function prepareReceiptDirectory(path) {
  await mkdir(path, { mode: 0o700 });
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined) {
    await chown(path, childIdentity.uid, childIdentity.gid);
  }
}

async function prepareWritableFile(path, contents) {
  await writeFile(path, contents, { mode: 0o600 });
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined) {
    await chown(path, childIdentity.uid, childIdentity.gid);
  }
}

test('preflights every cron mutation surface before installing the crontab', async () => {
  const source = await readFile(script, 'utf8');
  const preflight = source.indexOf(
    "revalidate_before install_crontab; cron_mutation_state >/dev/null || die 'cron mutation state scan failed'"
  );
  const install = source.indexOf('record_action install_crontab', preflight);
  assert.ok(preflight >= 0, 'cron mutation preflight is missing');
  assert.ok(
    install > preflight,
    'crontab installation precedes surface preflight'
  );
});

test('rejects a mounted state while recovering an absent at scheduler before unmounting', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-atq-absent-recovery-'))
  );
  await chmod(directory, 0o711);
  const receiptDirectory = join(directory, 'receipts');
  const atJobs = join(directory, 'atjobs');
  const mountState = join(directory, 'mount-state');
  const unmounted = join(directory, 'unmounted');
  const staged = await stageAtHelpers(directory);
  await Promise.all([prepareReceiptDirectory(receiptDirectory), mkdir(atJobs)]);
  await Promise.all([
    writeFile(
      join(receiptDirectory, 'pre-destructive.json'),
      '{"atSubmissionRollback":{"scheduler":"absent"}}\n',
      { mode: 0o644 }
    ),
    writeFile(
      join(receiptDirectory, 'pre-destructive.actions'),
      'quiesce_at_submissions\n',
      {
        mode: 0o644,
      }
    ),
    prepareWritableFile(mountState, 'rw\n'),
  ]);
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `. "$1"; RECEIPT_DIR=$2; AT_JOB_DIR=$3; MOUNT_STATE=$4; UNMOUNTED=$5
fsync_dir() { :; }; safe_file() { :; }; load_at_quiescence_helper
cron_inventory_at_scheduler_absent() { :; }
at_submission_mount_state() { cat "$MOUNT_STATE"; }
at_unmount_submission_spool() { : >"$UNMOUNTED"; printf 'absent\n' >"$MOUNT_STATE"; }
reconcile_interrupted_at_quiescence`,
          'retire-ollama-absent-at-recovery-mounted-test',
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
            RETIRE_OLLAMA_AT_QUIESCENCE_HELPER: join(
              staged,
              'retire-ollama-at-quiescence.sh'
            ),
          },
        }
      ),
      (error) => /at scheduler absence drift/.test(error.stderr)
    );
    await assert.rejects(
      readFile(unmounted),
      (error) => error?.code === 'ENOENT'
    );
    assert.equal(await readFile(mountState, 'utf8'), 'rw\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
