import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
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
const sourceSha = 'b'.repeat(40);
const sealedHelpers = [
  'retire-ollama.sh',
  'retire-ollama-source-loader.sh',
  'retire-ollama-recovery.sh',
  'retire-ollama-recovery-receipts.sh',
  'retire-ollama-consumers.sh',
  'retire-ollama-container-mounts.sh',
  'retire-ollama-running-container.sh',
  'retire-ollama-running-container-validation.sh',
  'retire-ollama-running-archive.sh',
  'retire-ollama-consumer-closure.sh',
  'retire-ollama-process-files.sh',
  'retire-ollama-cron-inventory.sh',
  'retire-ollama-at-quiescence.sh',
  'retire-ollama-temp-root.sh',
  'retire-ollama-image-filesystem.pl',
  'retire-ollama-projector-auth.sh',
];

function shellAt(pathname, command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-binding-test',
      pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  );
}

async function receiptBin() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-binding-bin-'));
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
    '#!/bin/sh\nif [ "$1" = -f ]; then [ "$2" = -- ] && p=$3 || p=$2; printf "%s\\n" "' +
      '$' +
      '{RETIRE_OLLAMA_TEST_REALPATH:-$p}' +
      '"; else exec /usr/bin/readlink "$@"; fi\n'
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

test('rejects a receipt after the sealed container validation helper is modified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-recovery-binding-'));
  const sealed = join(root, 'source', sourceSha);
  const receiptRoot = join(root, 'receipts');
  const snapshot = join(root, 'snapshot.json');
  const bin = await receiptBin();
  try {
    await mkdir(sealed, { recursive: true });
    await mkdir(receiptRoot, { mode: 0o700 });
    for (const name of sealedHelpers)
      await copyFile(new URL(`./${name}`, import.meta.url), join(sealed, name));
    await writeFile(
      snapshot,
      '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n'
    );
    const env = {
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      RETIRE_OLLAMA_RECOVERY_TEST_SOURCE_SHA: sourceSha,
    };
    await shellAt(
      join(sealed, 'retire-ollama.sh'),
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    const receipt = JSON.parse(
      await readFile(join(receiptRoot, sourceSha, 'recovery-scan.json'), 'utf8')
    );
    assert.equal(receipt.schemaVersion, 3);
    assert.match(
      receipt.sourceBinding.runningContainerSha256,
      /^[0-9a-f]{64}$/
    );
    assert.match(
      receipt.sourceBinding.runningContainerValidationSha256,
      /^[0-9a-f]{64}$/
    );
    assert.match(receipt.sourceBinding.consumerMountsSha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.sourceBinding.runningArchiveSha256, /^[0-9a-f]{64}$/);
    const mismatchedSource = join(root, 'mismatched-source.json');
    const forged = {
      ...receipt,
      sourceBinding: { ...receipt.sourceBinding, sourceSha: 'c'.repeat(40) },
    };
    await writeFile(mismatchedSource, JSON.stringify(forged), { mode: 0o600 });
    await chmod(mismatchedSource, 0o600);
    await assert.rejects(
      shellAt(
        join(sealed, 'retire-ollama.sh'),
        'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
        [mismatchedSource, sourceSha],
        env
      ),
      (error) => error.code === 1
    );
    await writeFile(
      join(sealed, 'retire-ollama-running-container-validation.sh'),
      '# helper drift\n',
      { flag: 'a' }
    );
    await assert.rejects(
      shellAt(
        join(sealed, 'retire-ollama.sh'),
        'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
        [join(receiptRoot, sourceSha, 'recovery-scan.json'), sourceSha],
        env
      ),
      (error) => error.code === 1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('rejects recovery startup when a newly bound helper is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baci-recovery-helper-missing-'));
  const sealed = join(root, 'source', sourceSha);
  try {
    await mkdir(sealed, { recursive: true });
    for (const name of sealedHelpers)
      await copyFile(new URL(`./${name}`, import.meta.url), join(sealed, name));
    await rm(join(sealed, 'retire-ollama-image-filesystem.pl'));
    await assert.rejects(
      shellAt(join(sealed, 'retire-ollama.sh'), ':', [], {
        RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
      }),
      (error) =>
        error.code === 78 &&
        /recovery consumer scanner helper missing/.test(error.stderr)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a receipt after each newly bound helper is substituted', async () => {
  const root = await mkdtemp(
    join(tmpdir(), 'baci-recovery-helper-substitution-')
  );
  const sealed = join(root, 'source', sourceSha);
  const receiptRoot = join(root, 'receipts');
  const snapshot = join(root, 'snapshot.json');
  const bin = await receiptBin();
  const helpers = [
    'retire-ollama-container-mounts.sh',
    'retire-ollama-image-filesystem.pl',
    'retire-ollama-projector-auth.sh',
    'retire-ollama-temp-root.sh',
  ];
  try {
    await mkdir(sealed, { recursive: true });
    await mkdir(receiptRoot, { mode: 0o700 });
    for (const name of sealedHelpers)
      await copyFile(new URL(`./${name}`, import.meta.url), join(sealed, name));
    await writeFile(
      snapshot,
      '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n'
    );
    const env = {
      RETIRE_OLLAMA_TEST_BIN: bin,
      RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
    };
    await shellAt(
      join(sealed, 'retire-ollama.sh'),
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"',
      [snapshot, sourceSha],
      env
    );
    const receipt = join(receiptRoot, sourceSha, 'recovery-scan.json');
    const legacyReceipt = join(root, 'legacy-v2.json');
    await writeFile(
      legacyReceipt,
      (await readFile(receipt, 'utf8')).replace(
        '"schemaVersion":3',
        '"schemaVersion":2'
      ),
      { mode: 0o600 }
    );
    await chmod(legacyReceipt, 0o600);
    await assert.rejects(
      shellAt(
        join(sealed, 'retire-ollama.sh'),
        'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
        [legacyReceipt, sourceSha],
        env
      ),
      (error) => error.code === 1
    );
    const multiDocument = join(root, 'multi-document.json');
    await writeFile(multiDocument, `null\n${await readFile(receipt, 'utf8')}`, {
      mode: 0o600,
    });
    await chmod(multiDocument, 0o600);
    await assert.rejects(
      shellAt(
        join(sealed, 'retire-ollama.sh'),
        'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
        [multiDocument, sourceSha],
        env
      ),
      (error) => error.code === 1
    );
    const extraKey = join(root, 'extra-key.json');
    const extraValue = JSON.parse(await readFile(receipt, 'utf8'));
    extraValue.unexpected = true;
    await writeFile(extraKey, JSON.stringify(extraValue), { mode: 0o600 });
    await chmod(extraKey, 0o600);
    await assert.rejects(
      shellAt(
        join(sealed, 'retire-ollama.sh'),
        'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
        [extraKey, sourceSha],
        env
      ),
      (error) => error.code === 1
    );
    for (const helper of helpers) {
      await writeFile(join(sealed, helper), '\n# substituted helper\n', {
        flag: 'a',
      });
      await assert.rejects(
        shellAt(
          join(sealed, 'retire-ollama.sh'),
          'RECOVERY_SOURCE_SHA="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_validate_json "$2"',
          [receipt, sourceSha],
          env
        ),
        (error) => error.code === 1
      );
      const original = await readFile(new URL(`./${helper}`, import.meta.url));
      await writeFile(join(sealed, helper), original);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
