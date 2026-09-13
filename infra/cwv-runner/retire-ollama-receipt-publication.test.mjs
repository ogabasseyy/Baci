import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

test('fails closed without nesting a pending receipt when target becomes a directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-receipt-target-race-'));
  try {
    const shell = String.raw`
. "$1"
RECEIPT_DIR="$2"
pending="$RECEIPT_DIR/receipt.json.pending"
target="$RECEIPT_DIR/receipt.json"
printf '%s\n' pending >"$pending"
mkdir -p "$target"
fsync_file() { :; }
fsync_dir() { :; }
stat() { printf '%s\n' '1:2:81a4:0:0:600'; }
mv() { [ "$1" = -T ] || return 99; mkdir -p "$3" || return 1; return 1; }
publish_pending "$pending" "$target" absent
`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        shell,
        'receipt-target-race-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 65
    );
    await access(join(directory, 'receipt.json.pending'));
    assert.equal(
      (await stat(join(directory, 'receipt.json'))).isDirectory(),
      true
    );
    await assert.rejects(
      access(join(directory, 'receipt.json', 'receipt.json.pending'))
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('fails closed without overwriting a regular target that appears after pending_for', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-receipt-regular-race-'));
  try {
    const shell = String.raw`
. "$1"
RECEIPT_DIR="$2"
pending_for() { printf '%s|absent\n' "$RECEIPT_DIR/receipt.json.pending"; }
pending_spec=$(pending_for "$RECEIPT_DIR/receipt.json")
pending=$(printf '%s\n' "$pending_spec" | cut -d'|' -f1)
target="$RECEIPT_DIR/receipt.json"
printf '%s\n' pending >"$pending"
printf '%s\n' attacker >"$target"
state=$(printf '%s\n' "$pending_spec" | cut -d'|' -f2)
stat() { printf '%s\n' '1:2:81a4:0:0:600'; }
mv() { [ "$1" = -T ] || return 99; /bin/cp "$2" "$3" && /bin/rm -f "$2"; }
publish_pending "$pending" "$target" "$state"
`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        shell,
        'receipt-regular-race-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 65
    );
    assert.equal((await stat(join(directory, 'receipt.json'))).isFile(), true);
    assert.equal(
      (await stat(join(directory, 'receipt.json.pending'))).isFile(),
      true
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('stops receipt writing when pending_for rejects its target', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-receipt-pending-reject-')
  );
  try {
    const shell = `
. "$1"
RECEIPT_DIR="$2"
ensure_receipt_dir() { :; }
assert_no_pending_receipts() { :; }
pending_for() { return 1; }
: >"$RECEIPT_DIR/snapshot"
write_receipt "$RECEIPT_DIR/snapshot"
`;
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        shell,
        'receipt-pending-reject-test',
        script.pathname,
        directory,
      ]),
      (error) => error.code === 65 && /receipt target unsafe/.test(error.stderr)
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

assert.ok(script.pathname.endsWith('retire-ollama.sh'));
