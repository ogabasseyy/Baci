import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sourceSha = 'a'.repeat(40);

async function shell(command, args = [], env = {}) {
  const procRoot = await mkdtemp(join(tmpdir(), 'baci-recovery-receipt-proc-'));
  await mkdir(join(procRoot, 'net'));
  await Promise.all(
    ['tcp', 'tcp6'].map((name) =>
      writeFile(
        join(procRoot, 'net', name),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      )
    )
  );
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'retire-ollama-recovery-receipt-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_PROC_ROOT: procRoot,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  ).finally(() => rm(procRoot, { recursive: true, force: true }));
}

async function testBin() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-recovery-bin-'));
  await writeFile(
    join(directory, 'sha256sum'),
    '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n'
  );
  await writeFile(
    join(directory, 'ln'),
    '#!/bin/sh\n[ "$1" = -- ] && shift\nexec /bin/ln "$@"\n'
  );
  await writeFile(
    join(directory, 'stat'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=(a.includes('-L')||a.includes('-Lc')?fs.statSync:fs.lstatSync)(p),m=s.mode&0o7777,t=s.mode.toString(16),type=(s.mode&0o170000)===0o040000?'directory':(s.mode&0o170000)===0o120000?'symbolic link':'regular file';const r=(f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino)).replaceAll('%f',t).replaceAll('%s',String(s.size)).replaceAll('%F',type);process.stdout.write(r+'\\n');\n`
  );
  await writeFile(
    join(directory, 'readlink'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),p=a.at(-1);if(a[0]==='-f')process.stdout.write((process.env.RETIRE_OLLAMA_TEST_REALPATH?fs.realpathSync(p):p)+'\\n');else if(a[0]==='--'&&process.env.RETIRE_OLLAMA_TEST_OBSERVED)process.stdout.write(process.env.RETIRE_OLLAMA_TEST_OBSERVED+'\\n');else if(a[0]==='--')process.stdout.write(fs.readlinkSync(p)+'\\n');else process.exit(1);\n`
  );
  await writeFile(
    join(directory, 'find'),
    '#!/bin/sh\nprintf "f:750:11:1.0:/safe/model.bin\\n"\n'
  );
  await writeFile(
    join(directory, 'findmnt'),
    '#!/bin/sh\nprintf "/safe ext4 rw\\n"\n'
  );
  await Promise.all(
    ['sha256sum', 'ln', 'stat', 'readlink', 'find', 'findmnt'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

test('publishes a source-bound fixed-path receipt with all source digests', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-receipt-')
  );
  const receiptRoot = join(directory, 'receipts');
  await mkdir(receiptRoot, { mode: 0o700 });
  const bin = await testBin();
  const snapshot = join(directory, 'snapshot.json');
  const outside = join(directory, 'outside.json');
  try {
    await writeFile(
      snapshot,
      '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n'
    );
    const { stdout } = await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$6"; RECOVERY_RECEIPT_ROOT="$3"; RETIRE_OLLAMA_RECOVERY_RECEIPT="$4"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$5"',
      [directory, receiptRoot, outside, snapshot, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
        RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: sourceSha,
      }
    );
    const receiptPath = join(receiptRoot, sourceSha, 'recovery-scan.json');
    const receiptBytes = await readFile(receiptPath);
    const receipt = JSON.parse(receiptBytes);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'destructiveAuthority',
      'inventoryBinding',
      'mode',
      'scan',
      'schemaVersion',
      'sourceBinding',
    ]);
    assert.equal(receipt.schemaVersion, 3);
    assert.equal(receipt.mode, 'recovery-scan');
    assert.equal(receipt.destructiveAuthority, false);
    assert.deepEqual(receipt.inventoryBinding, {
      requiresSeparateReview: true,
    });
    const sourceBindingKeys = [
      'atQuiescenceSha256',
      'consumerClosureSha256',
      'consumerMountsSha256',
      'consumersSha256',
      'cronInventorySha256',
      'helperSha256',
      'imageFilesystemSha256',
      'processFilesSha256',
      'projectorAuthSha256',
      'receiptsSha256',
      'runningArchiveSha256',
      'runningContainerSha256',
      'runningContainerValidationSha256',
      'scriptSha256',
      'sourceSha',
      'tempRootSha256',
    ];
    assert.deepEqual(
      Object.keys(receipt.sourceBinding).sort(),
      sourceBindingKeys
    );
    assert.equal(receipt.sourceBinding.sourceSha, sourceSha);
    for (const key of sourceBindingKeys.filter((key) => key !== 'sourceSha')) {
      assert.match(receipt.sourceBinding[key], /^[0-9a-f]{64}$/);
    }
    assert.equal(
      (await readFile(`${receiptPath}.sha256`, 'utf8')).trim(),
      stdout.trim()
    );
    assert.equal(
      (await readFile(`${receiptPath}.sha256`, 'utf8')).trim(),
      sha(receiptBytes)
    );
    await assert.rejects(readFile(outside, 'utf8'));
    const { stdout: retry } = await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
        RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: sourceSha,
      }
    );
    assert.equal(retry.trim(), stdout.trim());
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('refuses to publish a receipt for projector bytes not used by the scan', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-projector-drift-'));
  const receiptRoot = join(directory, 'receipts');
  const snapshot = join(directory, 'snapshot.json');
  const bin = await testBin();
  try {
    await mkdir(receiptRoot, { mode: 0o700 });
    await writeFile(snapshot, '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n');
    await assert.rejects(
      shell(
        'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$4"; running_projector_expected_sha=$(printf %064d 0); load_temp_root_helper; temp_root_required_bytes() { printf "1\\n"; }; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$3"',
        [directory, snapshot, sourceSha],
        { RETIRE_OLLAMA_TEST_BIN: bin, RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot, RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: sourceSha }
      ),
      (error) =>
        error.code !== 0 && /recovery source digest failed/.test(error.stderr)
    );
    await assert.rejects(
      readFile(join(receiptRoot, sourceSha, 'recovery-scan.json'))
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
