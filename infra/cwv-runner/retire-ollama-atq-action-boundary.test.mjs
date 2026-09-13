import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const quiescenceHelper = new URL(
  './retire-ollama-at-quiescence.sh',
  import.meta.url
);
const cronInventoryHelper = new URL(
  './retire-ollama-cron-inventory.sh',
  import.meta.url
);

function testEnvironment(bin, uid = process.getuid?.()) {
  const environment = {
    ...process.env,
    RETIRE_OLLAMA_TEST_BIN: bin,
  };
  delete environment.RETIRE_OLLAMA_AT_QUIESCENCE_HELPER;
  delete environment.RETIRE_OLLAMA_CRON_INVENTORY_HELPER;
  if (uid !== 0) {
    environment.RETIRE_OLLAMA_AT_QUIESCENCE_HELPER = quiescenceHelper.pathname;
    environment.RETIRE_OLLAMA_CRON_INVENTORY_HELPER =
      cronInventoryHelper.pathname;
  }
  return environment;
}

test('uses the sealed quiescence helper when the fixture runs as root', () => {
  assert.equal(
    testEnvironment('/usr/bin', 0).RETIRE_OLLAMA_AT_QUIESCENCE_HELPER,
    undefined
  );
  assert.equal(
    testEnvironment('/usr/bin', 1000).RETIRE_OLLAMA_AT_QUIESCENCE_HELPER,
    quiescenceHelper.pathname
  );
});

async function writeStatShim(bin) {
  await writeFile(
    join(bin, 'stat'),
    `#!/bin/sh
if [ "$(uname -s)" = Linux ]; then exec /usr/bin/stat "$@"; fi
[ "$1" = -c ] || exit 64
format=$2; path=$3
case "$format" in
  '%d:%i:%u:%g:%a')
    prefix=''; [ -k "$path" ] && prefix=1
    printf '%s:%s:%s:%s:%s%s\n' "$(/usr/bin/stat -f %d "$path")" "$(/usr/bin/stat -f %i "$path")" "$(/usr/bin/stat -f %u "$path")" "$(/usr/bin/stat -f %g "$path")" "$prefix" "$(/usr/bin/stat -f %Lp "$path")";;
  '%u:%g:%a') exec /usr/bin/stat -f '%u:%g:%Lp' "$path";;
  '%u:%a') printf '0:'; exec /usr/bin/stat -f '%Lp' "$path";;
  *) exit 64;;
esac
`
  );
  await chmod(join(bin, 'stat'), 0o755);
}

async function runApplyWithLateAtJob(target) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-atq-action-'));
  const receiptDirectory = join(directory, 'receipts');
  const receipt = join(directory, 'receipt.json');
  const inventory = join(directory, 'inventory.json');
  const queue = join(directory, 'atq');
  const actions = join(directory, 'actions');
  await execFileAsync('mkdir', ['-p', receiptDirectory]);
  await writeFile(receipt, '{"scan":{"dependencies":[]}}\n');
  await writeFile(inventory, '{"reviewStatus":"approved"}\n');
  try {
    await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; load_at_quiescence_helper; load_cron_inventory_helper() { :; }
RECEIPT_DIR=$2; RECEIPT=$3; INVENTORY=$4; QUEUE=$5; ACTIONS=$6; TARGET=$7
root() { :; }; init_temp_root() { :; }; cleanup_temp() { :; }
canonical_receipt() { :; }; assert_approved_dependency_classes() { :; }; assert_zero_consumers() { :; }
approved_dependency_sha() { printf 'approved\\n'; }; dependency_sha() { printf 'approved\\n'; }
ensure_receipt_dir() { :; }; pending_for() { printf '%s.pending\\n' "$1"; }; publish_pending() { mv "$1" "$2"; }
completion_metrics() { printf '{"cgroupMemoryBytes":0,"hostAvailableMemoryBytes":0,"modelStoreBytes":0}\\n'; }
canonical_receipt_digest() { printf '%064d\\n' 0; }
record_action() { :; }
revalidate_before() { if [ "$1" = "$TARGET" ]; then printf 'queued\\n' >"$QUEUE"; else : >"$QUEUE"; fi; }
cron_inventory_require_empty_at_queue() { [ ! -s "$QUEUE" ]; }
at_submission_state() { printf '{}\\n'; }; quiesce_at_submissions() { :; }
assert_at_submissions_quiesced() { cron_inventory_require_empty_at_queue || die 'queued work or an unsafe queue'; }
cron_mutation_state() { printf '[]\\n'; }; quiesce_cron_mutations() { [ "$TARGET" != post_bind_crontab ] || printf 'changed after install\\n' >"$QUEUE.cron-race"; }
assert_scheduled_mutations_quiesced() { assert_at_submissions_quiesced "$1"; }
assert_postcondition() { [ "$1" != install_crontab ] || [ ! -s "$QUEUE.cron-race" ] || die 'crontab postcondition drift'; }
install_crontab() { printf '%s\\n' install_crontab >>"$ACTIONS"; }
disable_unit() { printf '%s\\n' disable_unit >>"$ACTIONS"; }
remove_container() { printf '%s\\n' remove_container >>"$ACTIONS"; }
delete_models() { printf '%s\\n' delete_models >>"$ACTIONS"; }
apply`,
        `${script.pathname}.source`,
        script.pathname,
        receiptDirectory,
        receipt,
        inventory,
        queue,
        actions,
        target,
      ],
      { env: testEnvironment('/usr/bin') }
    );
    return { error: null, actions: await readFile(actions, 'utf8') };
  } catch (error) {
    let performed = '';
    try {
      performed = await readFile(actions, 'utf8');
    } catch {
      // No destructive action ran before the refusal.
    }
    return { error, actions: performed };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const action of [
  'install_crontab',
  'disable_unit',
  'remove_container',
  'delete_models',
]) {
  test(`refuses ${action} when an at job appears after its full revalidation`, async () => {
    const result = await runApplyWithLateAtJob(action);
    assert.equal(result.error?.code, 65);
    assert.match(result.error?.stderr ?? '', /queued work or an unsafe queue/);
    assert.ok(!result.actions.split('\n').includes(action));
  });
}

test('refuses a crontab replacement after install and before the cron bind', async () => {
  const result = await runApplyWithLateAtJob('post_bind_crontab');
  assert.equal(result.error?.code, 65);
  assert.match(result.error?.stderr ?? '', /crontab postcondition drift/);
  assert.match(result.actions, /^install_crontab$/m);
  assert.doesNotMatch(result.actions, /^disable_unit$/m);
});

test('blocks an at submission after the terminal queue check and before model deletion', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-atq-quiescence-'))
  );
  const bin = join(directory, 'bin');
  const receiptDirectory = join(directory, 'receipts');
  const atJobs = join(directory, 'atjobs');
  const receipt = join(directory, 'receipt.json');
  const inventory = join(directory, 'inventory.json');
  const actions = join(directory, 'actions');
  const mountState = join(directory, 'mount-state');
  await Promise.all([
    mkdir(bin),
    mkdir(receiptDirectory),
    mkdir(atJobs, { mode: 0o1770 }),
    writeFile(receipt, '{"scan":{"dependencies":[]}}\n'),
    writeFile(inventory, '{"reviewStatus":"approved"}\n'),
    writeFile(mountState, 'absent\n'),
  ]);
  await chmod(atJobs, 0o1770);
  await writeFile(join(atJobs, '.SEQ'), '0\n', { mode: 0o600 });
  await writeStatShim(bin);
  try {
    await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; load_at_quiescence_helper; load_cron_inventory_helper() { :; }
RECEIPT_DIR=$2; RECEIPT=$3; INVENTORY=$4; AT_JOB_DIR=$5; ACTIONS=$6; MOUNT_STATE=$7
root() { :; }; init_temp_root() { :; }; cleanup_temp() { :; }; fsync_dir() { :; }
canonical_receipt() { :; }; assert_approved_dependency_classes() { :; }; assert_zero_consumers() { :; }
approved_dependency_sha() { printf 'approved\\n'; }; dependency_sha() { printf 'approved\\n'; }
ensure_receipt_dir() { :; }; pending_for() { printf '%s.pending\\n' "$1"; }; publish_pending() { mv "$1" "$2"; }
completion_metrics() { printf '{"cgroupMemoryBytes":0,"hostAvailableMemoryBytes":0,"modelStoreBytes":0}\\n'; }
canonical_receipt_digest() { printf '%064d\\n' 0; }
revalidate_before() { :; }; cron_inventory_require_empty_at_queue() { :; }
at_submission_mount_state() { cat "$MOUNT_STATE"; }
at_create_bind_mount() { printf 'rw\\n' >"$MOUNT_STATE"; }
at_remount_bind_readonly() { printf 'ro\\n' >"$MOUNT_STATE"; }
at_unmount_submission_spool() { printf 'absent\\n' >"$MOUNT_STATE"; }
cron_mutation_state() { printf '[]\\n'; }
quiesce_cron_mutations() { :; }
assert_scheduled_mutations_quiesced() { assert_at_submissions_quiesced "$1"; }
assert_postcondition() { :; }
install_crontab() { printf '%s\\n' install_crontab >>"$ACTIONS"; }
disable_unit() { printf '%s\\n' disable_unit >>"$ACTIONS"; }
remove_container() { printf '%s\\n' remove_container >>"$ACTIONS"; }
delete_models() { [ "$(cat "$MOUNT_STATE")" = ro ] || printf '%s\\n' submitted >>"$ACTIONS"; printf '%s\\n' delete_models >>"$ACTIONS"; }
apply`,
        `${script.pathname}.source`,
        script.pathname,
        receiptDirectory,
        receipt,
        inventory,
        atJobs,
        actions,
        mountState,
      ],
      { env: testEnvironment(bin) }
    );
    const performed = await readFile(actions, 'utf8');
    assert.doesNotMatch(performed, /^submitted$/m);
    assert.match(performed, /^delete_models$/m);
    assert.match(
      await readFile(join(receiptDirectory, 'pre-destructive.actions'), 'utf8'),
      /^quiesce_at_submissions$/m
    );
    assert.equal(await readFile(mountState, 'utf8'), 'ro\n');
    assert.equal((await stat(atJobs)).mode & 0o7777, 0o1770);
    const rollback = JSON.parse(
      await readFile(join(receiptDirectory, 'pre-destructive.json'), 'utf8')
    ).atSubmissionRollback;
    assert.equal(rollback.path, atJobs);
    assert.equal(rollback.originalMountState, 'absent');
    assert.equal(rollback.quiescedMountState, 'ro-bind');
    assert.match(rollback.identity, /^\d+:\d+:\d+:\d+$/);
    assert.match(rollback.sequenceIdentity, /^\d+:\d+:\d+:\d+$/);
  } finally {
    await chmod(atJobs, 0o1770);
    await rm(directory, { recursive: true, force: true });
  }
});
