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
async function prepareReceiptDirectory(path) {
  await mkdir(path, { mode: 0o700 });
  if (childIdentity.uid !== undefined && childIdentity.gid !== undefined) {
    await chown(path, childIdentity.uid, childIdentity.gid);
  }
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baci-cron-atq-')));
  await chmod(root, 0o777);
  const system = join(root, 'crontab');
  const systemDir = join(root, 'cron.d');
  const spool = join(root, 'spool');
  await Promise.all([
    mkdir(systemDir),
    mkdir(spool),
    writeFile(system, '0 * * * * /usr/bin/other\n'),
  ]);
  return { root, spool, system, systemDir };
}
async function executable(path, body) {
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
}
function collect(source, atq, state) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); init_temp_root; trap cleanup_temp EXIT
load_cron_inventory_helper
cron_inventory_system_file_ok() { return 0; }
cron_inventory_system_dir_ok() { return 0; }
cron_inventory_spool_dir_ok() { return 0; }
OWNER=bassey
cron_inventory_collect_external "$4"`,
      'retire-ollama-cron-atq-test',
      script.pathname,
      source.system,
      source.systemDir,
      join(source.root, 'manifest'),
    ],
    {
      ...childIdentity,
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
        RETIRE_OLLAMA_ATQ: atq,
        RETIRE_OLLAMA_AT_ABSENCE_ROOT: source.root,
        RETIRE_OLLAMA_CRON_SYSTEM_FILE: source.system,
        RETIRE_OLLAMA_CRON_SYSTEM_DIR: source.systemDir,
        RETIRE_OLLAMA_CRON_SPOOL_DIR: source.spool,
        RETIRE_OLLAMA_ANACRONTAB: join(source.root, 'absent-anacron'),
        RETIRE_OLLAMA_CRON_HOURLY_DIR: join(source.root, 'absent-hourly'),
        RETIRE_OLLAMA_CRON_DAILY_DIR: join(source.root, 'absent-daily'),
        RETIRE_OLLAMA_CRON_WEEKLY_DIR: join(source.root, 'absent-weekly'),
        RETIRE_OLLAMA_CRON_MONTHLY_DIR: join(source.root, 'absent-monthly'),
        ATQ_STATE: state ?? '',
      },
    }
  );
}
test('accepts an empty at queue at both scheduled-work inventory boundaries', async () => {
  const source = await fixture();
  const atq = join(source.root, 'atq');
  try {
    await executable(atq, 'exit 0');
    await collect(source, atq);
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('fails closed when a queued at job can launch an Ollama consumer or recreate its service', async () => {
  const source = await fixture();
  const atq = join(source.root, 'atq');
  try {
    await executable(atq, "printf '42\\tSun Aug 3 12:00:00 2026 a root\\n'");
    await assert.rejects(collect(source, atq), (error) =>
      /queued at work or unsafe at queue/.test(error.stderr)
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('fails closed when an at job appears during scheduled-work inventory', async () => {
  const source = await fixture();
  const atq = join(source.root, 'atq');
  const state = join(source.root, 'atq-state');
  try {
    await executable(
      atq,
      '[ -e "$ATQ_STATE" ] && printf \'43\\tSun Aug 3 12:01:00 2026 a root\\n\' || : >"$ATQ_STATE"'
    );
    await assert.rejects(collect(source, atq, state), (error) =>
      /queued at work or unsafe at queue/.test(error.stderr)
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('accepts a fully absent at scheduler without weakening partial-state checks', async () => {
  const source = await fixture();
  const atq = join(source.root, 'atq');
  try {
    await collect(source, atq);
    await mkdir(join(source.root, 'var/spool/cron/atjobs'), {
      recursive: true,
    });
    await assert.rejects(collect(source, atq), (error) =>
      /queued at work or unsafe at queue/.test(error.stderr)
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('refuses destructive apply when an absent at scheduler cannot be kept quiesced', async () => {
  await assert.rejects(
    execFileAsync('sh', [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_cron_inventory_helper; load_at_quiescence_helper
AT_JOB_DIR=/fixture/absent-atjobs
cron_inventory_at_scheduler_absent() { :; }
cron_inventory_require_empty_at_queue() { :; }
at_submission_mount_state() { printf '%s\\n' absent; }
at_create_bind_mount() { return 91; }
expected=$(at_submission_state)
[ "$expected" = '{"scheduler":"absent"}' ]
quiesce_at_submissions "$expected"`,
      'retire-ollama-absent-at-apply-test',
      script.pathname,
    ]),
    (error) =>
      error.code === 65 &&
      /absent at scheduler cannot be quiesced/.test(error.stderr)
  );
});
test('production apply loads cron inventory before refusing an absent at scheduler', async () => {
  const source = await fixture();
  const receiptDirectory = join(source.root, 'receipts');
  await Promise.all([
    prepareReceiptDirectory(receiptDirectory),
    writeFile(
      join(source.root, 'receipt.json'),
      '{"scan":{"dependencies":[]}}\n'
    ),
    writeFile(
      join(source.root, 'inventory.json'),
      '{"reviewStatus":"approved"}\n'
    ),
  ]);
  try {
    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `. "$1"; SCRIPT_DIR=$(dirname "$1")
RECEIPT_DIR=$2; RECEIPT=$3; INVENTORY=$4
root() { :; }; init_temp_root() { :; }; cleanup_temp() { :; }
canonical_receipt() { :; }; assert_approved_dependency_classes() { :; }; assert_zero_consumers() { :; }
approved_dependency_sha() { printf 'approved\\n'; }; dependency_sha() { printf 'approved\\n'; }
ensure_receipt_dir() { :; }; pending_for() { printf '%s.pending\\n' "$1"; }; publish_pending() { mv "$1" "$2"; }
completion_metrics() { printf '{"cgroupMemoryBytes":0,"hostAvailableMemoryBytes":0,"modelStoreBytes":0}\\n'; }
canonical_receipt_digest() { printf '%064d\\n' 0; }
record_action() { :; }; revalidate_before() { :; }; assert_scheduled_mutations_quiesced() { :; }
cron_mutation_state() { printf '[]\\n'; }; quiesce_cron_mutations() { :; }; assert_postcondition() { :; }
install_crontab() { :; }; disable_unit() { :; }; remove_container() { :; }; delete_models() { :; }
load_at_quiescence_helper() { . "$SCRIPT_DIR/retire-ollama-at-quiescence.sh"; cron_mutation_state() { printf '[]\\n'; }; quiesce_cron_mutations() { :; }; assert_postcondition() { :; }; assert_scheduled_mutations_quiesced() { :; }; }
apply
`,
          'retire-ollama-absent-at-production-apply-test',
          script.pathname,
          receiptDirectory,
          join(source.root, 'receipt.json'),
          join(source.root, 'inventory.json'),
        ],
        {
          ...childIdentity,
          env: {
            ...process.env,
            RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
            RETIRE_OLLAMA_ATQ: join(source.root, 'absent-atq'),
            RETIRE_OLLAMA_AT_ABSENCE_ROOT: source.root,
            RETIRE_OLLAMA_AT_QUIESCENCE_HELPER: '',
          },
        }
      ),
      (error) =>
        error.code === 65 &&
        /absent at scheduler cannot be quiesced/.test(error.stderr)
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('fails closed when atq returns an error', async () => {
  const source = await fixture();
  const atq = join(source.root, 'atq');
  try {
    await executable(atq, 'exit 7');
    await assert.rejects(collect(source, atq), (error) =>
      /queued at work or unsafe at queue/.test(error.stderr)
    );
  } finally {
    await rm(source.root, { recursive: true, force: true });
  }
});
test('keeps the cron inventory implementation within the modularity limit', async () => {
  const source = await readFile(
    new URL('./retire-ollama-cron-inventory.sh', import.meta.url),
    'utf8'
  );
  assert.ok(source.trimEnd().split('\n').length <= 300);
});
