import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const sourceSha = 'b'.repeat(40);

function shell(command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-review-cleanup-test',
      script.pathname,
      ...args,
    ],
    { env: { ...process.env, ...env } }
  );
}

async function receiptBin() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-bin-'));
  await chmod(directory, 0o755);
  await writeFile(
    join(directory, 'sha256sum'),
    '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n'
  );
  await writeFile(
    join(directory, 'ln'),
    '#!/bin/sh\n[ "$1" = -- ] && shift\nexec /bin/ln "$@"\n'
  );
  await writeFile(
    join(directory, 'readlink'),
    '#!/bin/sh\nif [ "$1" = -f ]; then [ "$2" = -- ] && p=$3 || p=$2; printf "%s\\n" "$' +
      '{RETIRE_OLLAMA_TEST_REALPATH:-$p}"; else exec /usr/bin/readlink "$@"; fi\n'
  );
  await writeFile(
    join(directory, 'stat'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=(a.includes('-L')||a.includes('-Lc')?fs.statSync:fs.lstatSync)(p),m=s.mode&0o7777,t=s.mode.toString(16),type=(s.mode&0o170000)===0o040000?'directory':(s.mode&0o170000)===0o120000?'symbolic link':'regular file';const r=(f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino)).replaceAll('%f',t).replaceAll('%F',type);process.stdout.write(r+'\\n');\n`
  );
  await Promise.all(
    ['sha256sum', 'ln', 'readlink', 'stat'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

test('cleans the exact stored scan temporary before reporting snapshot drift', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-drift-cleanup-')
  );
  const receiptRoot = join(directory, 'receipts');
  const snapshot = join(directory, 'snapshot.json');
  const bin = await receiptBin();
  await mkdir(receiptRoot, { mode: 0o700 });
  try {
    await writeFile(snapshot, '{"surfaces":[],"dependencies":[]}\n');
    const env = {
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
      RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
    };
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    const { stdout } = await shell(
      `calls=0; observed=; review_marker="$RETIRE_OLLAMA_RECOVERY_TEST_ROOT/review-marker"; recovery_drift_snapshot() { calls=$((calls + 1)); if [ "$calls" -eq 2 ]; then observed=$2; printf '%s\\n' '{"changed":true}' >"$2"; else /usr/bin/jq -S . "$1" >"$2"; fi; }; review_required() { [ -n "$observed" ] || { printf 'review-required-before-observed\\n' >&2; exit 91; }; printf '%s\\n' "$observed" >"$review_marker"; [ ! -e "$observed" ] || exit 92; printf clean; exit 0; }; fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"`,
      [snapshot, sourceSha],
      env
    );
    assert.equal(stdout.trim(), 'clean');
    const observed = (
      await readFile(join(receiptRoot, 'review-marker'), 'utf8')
    ).trim();
    assert.notEqual(observed, '');
    await assert.rejects(readFile(observed));
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
