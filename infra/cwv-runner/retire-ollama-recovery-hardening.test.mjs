import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const sourceSha = 'a'.repeat(40);

async function shell(command, args = [], env = {}) {
  const procRoot = await mkdtemp(join(tmpdir(), 'baci-recovery-proc-'));
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
      'recovery-hardening-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_PROC_ROOT: procRoot,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  ).finally(() => rm(procRoot, { recursive: true, force: true }));
}

async function testBin() {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-hardening-bin-')
  );
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
  await Promise.all(
    ['sha256sum', 'ln', 'stat', 'readlink'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

async function receiptSnapshot(directory) {
  const snapshot = join(directory, 'snapshot.json');
  await writeFile(
    snapshot,
    '{"surfaces":[],"dependencies":[],"consumerCounts":[],"consumerEvidence":[]}\n'
  );
  return snapshot;
}

test('binds a container Ollama process to inspect Path without a host executable allowlist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-recovery-exe-'));
  const bin = await testBin();
  const proc = join(directory, 'proc');
  const pidDir = join(proc, '41');
  const executable = join(directory, 'ollama-overlay-executable');
  try {
    await mkdir(pidDir, { recursive: true });
    await writeFile(executable, 'container Ollama bytes');
    await chmod(executable, 0o755);
    await symlink(executable, join(pidDir, 'exe'));
    await mkdir(join(directory, 'rootfs', 'bin'), { recursive: true });
    await symlink(executable, join(directory, 'rootfs', 'bin', 'ollama'));
    await symlink(join(directory, 'rootfs'), join(pidDir, 'root'));
    await writeFile(
      join(pidDir, 'stat'),
      `41 (ollama) ${['S', ...Array(18).fill('1'), '42'].join(' ')}\n`
    );
    await writeFile(
      join(pidDir, 'status'),
      'Name:\tollama\nUid:\t1000\t1000\t1000\t1000\n'
    );
    const { stdout } = await shell(
      'init_temp_root; trap cleanup_temp EXIT; RECOVERY_PROC_ROOT="$2"; recovery_process_executable 41 /bin/ollama ollama',
      [proc],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_TEST_OBSERVED: '/bin/ollama',
        RETIRE_OLLAMA_TEST_REALPATH: '1',
      }
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(
      snapshot.path,
      process.getuid?.() === 0
        ? await realpath(join(pidDir, 'exe'))
        : '/bin/ollama'
    );
    assert.equal(snapshot.realPath, await realpath(executable));
    assert.equal(snapshot.uid, '1000');
    assert.equal(snapshot.kind, 'ollama');
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('creates the intermediate production-shaped receipt directories and repairs a JSON-only crash', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-receipt-crash-')
  );
  const receiptRoot = join(directory, 'receipts');
  await mkdir(receiptRoot, { mode: 0o700 });
  const bin = await testBin();
  const snapshot = await receiptSnapshot(directory);
  const json = join(receiptRoot, sourceSha, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  try {
    const { stdout } = await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_RECOVERY_TEST_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"; rm -f "$4"; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, digest, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    );
    assert.equal(stdout.trim().split('\n').length, 2);
    assert.equal(
      (await readFile(digest, 'utf8')).trim(),
      createHash('sha256')
        .update(await readFile(json))
        .digest('hex')
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('repairs a JSON-pending-only and digest-plus-JSON-pending publication boundary', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-pending-')
  );
  const receiptRoot = join(directory, 'receipts');
  await mkdir(receiptRoot, { mode: 0o700 });
  const bin = await testBin();
  const snapshot = await receiptSnapshot(directory);
  const json = join(receiptRoot, sourceSha, 'recovery-scan.json');
  const digest = `${json}.sha256`;
  try {
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_RECOVERY_TEST_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"; mv "$6" "$6.pending"; rm -f "$4"; recovery_write_receipt "$2"; mv "$6" "$6.pending"; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, digest, sourceSha, json],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    );
    assert.equal((await readFile(json)).length > 0, true);
    assert.equal((await readFile(digest, 'utf8')).trim().length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
test('refuses unmodeled surface failures and rejects malformed source identities', async () => {
  await assert.rejects(
    shell(
      'recovery_systemctl() { return 2; }; init_temp_root; RECOVERY_RECORDS="[]"; recovery_surface systemd-definitions recovery_systemd_cat ollama.service'
    ),
    (error) => error.code === 65 && /recovery surface failed/.test(error.stderr)
  );
  const { stdout } = await shell(
    'for value in "$2" "$3" "$4"; do SCRIPT_DIR="/srv/baci-cwv/source/$value"; if recovery_source_identity "$value"; then printf "1\\n"; else printf "0\\n"; fi; done',
    [sourceSha, sourceSha.slice(0, -1), 'g'.repeat(40)]
  );
  assert.deepEqual(stdout.trim().split('\n'), ['1', '0', '0']);
});

test('refuses an optional EnvironmentFile symlink instead of treating it as absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-recovery-env-'));
  const target = join(directory, 'environment');
  const link = join(directory, 'environment.link');
  try {
    await writeFile(target, 'OLLAMA_HOST=127.0.0.1\n');
    await symlink(target, link);
    await assert.rejects(
      shell(
        'init_temp_root; trap cleanup_temp EXIT; recovery_record_environment "$2" 1',
        [link]
      ),
      (error) =>
        error.code === 65 && /symlinked recovery reference/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe canonical receipt mode and unknown pending residue', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-receipt-safety-')
  );
  const receiptRoot = join(directory, 'receipts');
  await mkdir(receiptRoot, { mode: 0o700 });
  const bin = await testBin();
  const snapshot = await receiptSnapshot(directory);
  const json = join(receiptRoot, sourceSha, 'recovery-scan.json');
  try {
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_RECOVERY_TEST_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"; chmod 0644 "$4"; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, json, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    ).then(
      () => assert.fail('unsafe canonical receipt should be refused'),
      (error) => assert.match(error.stderr, /recovery receipt JSON unsafe/)
    );
    await chmod(json, 0o600);
    await shell(
      'fsync_file() { :; }; fsync_dir() { :; }; RECOVERY_SOURCE_SHA="$5"; RETIRE_OLLAMA_RECOVERY_TEST_ROOT="$3"; init_temp_root; trap cleanup_temp EXIT; recovery_write_receipt "$2"; : > "$4.extra.pending"; recovery_write_receipt "$2"',
      [snapshot, receiptRoot, json, sourceSha],
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_RECOVERY_TEST_ROOT: receiptRoot,
      }
    ).then(
      () => assert.fail('unknown pending residue should be refused'),
      (error) => assert.match(error.stderr, /pending residue/)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});
