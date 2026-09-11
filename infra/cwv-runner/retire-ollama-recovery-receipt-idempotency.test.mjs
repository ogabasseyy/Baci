import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
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
const sourceSha = 'c'.repeat(40);

function shell(command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-receipt-idempotency-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        ...env,
      },
    }
  );
}

async function testBin() {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-idempotency-bin-')
  );
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
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),p=a.at(-1);if(a[0]==='-f')process.stdout.write(fs.realpathSync(p)+'\\n');else process.stdout.write(fs.readlinkSync(p)+'\\n');\n`
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

test('retries an identical receipt without rewriting or leaving publication residue', async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'baci-recovery-idempotency-'))
  );
  const receiptRoot = join(directory, 'receipts');
  const snapshot = join(directory, 'snapshot.json');
  const bin = await testBin();
  const env = {
    RETIRE_OLLAMA_TEST_BIN: bin,
    RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
    RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
    RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: sourceSha,
  };
  try {
    await chmod(directory, 0o755);
    await mkdir(receiptRoot, { mode: 0o700 });
    await writeFile(
      snapshot,
      '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n'
    );
    const command =
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; RECOVERY_RECEIPT_ROOT="$4"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"';
    const first = await shell(command, [snapshot, sourceSha, receiptRoot], env);
    const receiptDirectory = join(receiptRoot, sourceSha);
    const json = join(receiptDirectory, 'recovery-scan.json');
    const digest = `${json}.sha256`;
    const firstJson = await readFile(json);
    const firstDigest = await readFile(digest);
    const second = await shell(
      command,
      [snapshot, sourceSha, receiptRoot],
      env
    );
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(await readFile(json), firstJson);
    assert.deepEqual(await readFile(digest), firstDigest);
    assert.deepEqual((await readdir(receiptDirectory)).sort(), [
      'recovery-scan.json',
      'recovery-scan.json.sha256',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('retains both hardlink names when publication directory sync fails before unlink', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-link-durability-')
  );
  const pending = join(directory, 'receipt.pending');
  const target = join(directory, 'receipt.json.pending');
  try {
    await writeFile(pending, '{}', { mode: 0o600 });
    const result = await shell(
      'recovery_safe_receipt_file() { :; }; recovery_safe_receipt_ancestry() { :; }; fsync_file() { :; }; syncs=0; fsync_dir() { syncs=$((syncs + 1)); [ "$syncs" -lt 1 ]; }; if recovery_publish_link "$2" "$3"; then printf published; else printf refused; fi; [ -e "$2" ] && [ -e "$3" ] && printf :retained',
      [pending, target]
    );
    assert.equal(result.stdout, 'refused:retained');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
