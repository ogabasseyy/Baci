import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('refuses an absent at scheduler before publishing recovery state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-atq-absent-retry-'));
  const receiptDirectory = join(directory, 'receipts');
  const receipt = join(directory, 'receipt.json');
  const inventory = join(directory, 'inventory.json');
  const publicationMarker = join(directory, 'publication-attempted');
  await execFileAsync('mkdir', ['-p', receiptDirectory]);
  await writeFile(receipt, '{"scan":{"dependencies":[]}}\n');
  await writeFile(inventory, '{"reviewStatus":"approved"}\n');

  const apply = () =>
    execFileAsync('sh', [
      '-c',
      `. "$1"
RECEIPT_DIR=$2; RECEIPT=$3; INVENTORY=$4; PUBLICATION_MARKER=$5
root() { :; }; init_temp_root() { :; }; cleanup_temp() { :; }
canonical_receipt() { :; }; assert_approved_dependency_classes() { :; }; assert_zero_consumers() { :; }
approved_dependency_sha() { printf 'approved\\n'; }; dependency_sha() { printf 'approved\\n'; }
ensure_receipt_dir() { :; }; load_cron_inventory_helper() { :; }; load_at_quiescence_helper() { :; }
reconcile_interrupted_at_quiescence() { :; }; at_submission_state() { printf '{"scheduler":"absent"}\\n'; }
pending_for() { printf attempted >"$PUBLICATION_MARKER"; return 1; }
apply`,
      `${script.pathname}.source`,
      script.pathname,
      receiptDirectory,
      receipt,
      inventory,
      publicationMarker,
    ]);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        apply(),
        (error) =>
          error.code === 65 &&
          /absent at scheduler cannot be quiesced/.test(error.stderr)
      );
      await assert.rejects(readFile(publicationMarker));
      await assert.rejects(
        readFile(join(receiptDirectory, 'pre-destructive.json'))
      );
      await assert.rejects(
        readFile(join(receiptDirectory, 'pre-destructive.actions'))
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
