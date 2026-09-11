import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('fails closed when receipt digest calculation fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-receipt-sha-failure-'));
  const snapshot = join(directory, 'snapshot.json');
  const receipt = join(directory, 'recovery-scan.json');
  const digest = `${receipt}.sha256`;
  await writeFile(snapshot, '{}\n');
  try {
    const shell = String.raw`
. "$1"
RECEIPT_DIR="$2"
RECEIPT="$3"
RECEIPT_SHA="$4"
receipt_pending="$RECEIPT.pending"
ensure_receipt_dir() { :; }
assert_no_pending_receipts() { :; }
pending_for() { printf '%s|absent\n' "$1.pending"; }
discard_pending() { /bin/rm -f -- "$1"; }
publish_pending() { /bin/mv -- "$1" "$2"; }
sha() { [ "$1" = "$receipt_pending" ] && return 77; /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }
write_receipt "$5"
`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        shell,
        'receipt-sha-failure-test',
        script.pathname,
        directory,
        receipt,
        digest,
        snapshot,
      ]),
      (error) => error.code === 65 && /receipt digest failed/.test(error.stderr)
    );
    for (const path of [
      receipt,
      digest,
      `${receipt}.pending`,
      `${digest}.pending`,
    ]) {
      await assert.rejects(access(path), { code: 'ENOENT' });
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('keeps JSON pending when the second publication fails after digest commit', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-receipt-second-publish-')
  );
  const snapshot = join(directory, 'snapshot.json');
  const receipt = join(directory, 'recovery-scan.json');
  const digest = `${receipt}.sha256`;
  await writeFile(snapshot, '{}\n');
  try {
    const shell = String.raw`
. "$1"
RECEIPT_DIR="$2"
RECEIPT="$3"
RECEIPT_SHA="$4"
ensure_receipt_dir() { :; }
assert_no_pending_receipts() { :; }
pending_for() { printf '%s|absent\n' "$1.pending"; }
discard_pending() { /bin/rm -f -- "$1"; }
publish_calls=0
publish_pending() { publish_calls=$((publish_calls + 1)); [ "$publish_calls" -eq 1 ] && /bin/mv -- "$1" "$2" || return 77; }
sha() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }
write_receipt "$5"
`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        shell,
        'receipt-second-publish-test',
        script.pathname,
        directory,
        receipt,
        digest,
        snapshot,
      ]),
      (error) => error.code === 77
    );
    await access(digest);
    await access(`${receipt}.pending`);
    await assert.rejects(access(receipt), { code: 'ENOENT' });
    assert.equal(
      (await readFile(digest, 'utf8')).trim(),
      createHash('sha256')
        .update(await readFile(`${receipt}.pending`))
        .digest('hex')
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

assert.ok(script.pathname.endsWith('retire-ollama.sh'));
