import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
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

function shell(command, args = [], env = {}) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); RECOVERY_HELPER="$SCRIPT_DIR/retire-ollama-recovery.sh"; . "$RECOVERY_HELPER"; [ -z "\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}" ] || RECOVERY_RECEIPT_ROOT="\${RETIRE_OLLAMA_RECOVERY_TEST_ROOT:-}"; ${command}`,
      'recovery-ancestry-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: '/sbin',
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  );
}

async function testBin() {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-ancestry-bin-')
  );
  await writeFile(
    join(directory, 'sha256sum'),
    '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n'
  );
  await writeFile(
    join(directory, 'readlink'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),p=a.at(-1);if(a[0]==='-f')process.stdout.write(fs.realpathSync(p)+'\\n');else if(a[0]==='--')process.stdout.write(fs.readlinkSync(p)+'\\n');else process.exit(1);\n`
  );
  await writeFile(
    join(directory, 'stat'),
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=(a.includes('-L')||a.includes('-Lc')?fs.statSync:fs.lstatSync)(p),m=s.mode&0o7777;const r=(f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino));process.stdout.write(r+'\\n');\n`
  );
  await Promise.all(
    ['sha256sum', 'readlink', 'stat'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

test('accepts root scanner UID and PID 1 with PPID zero in ancestry evidence', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-ancestry-')
  );
  const bin = await testBin();
  const proc = join(directory, 'proc');
  const processes = join(directory, 'processes');
  const executable = join(directory, 'scanner');
  const namespace = join(directory, 'namespace');
  try {
    await writeFile(executable, 'scanner bytes');
    await chmod(executable, 0o755);
    await writeFile(namespace, 'pid namespace');
    for (const [pid, , start] of [
      ['10', '1', '42'],
      ['1', '0', '43'],
    ]) {
      const pidDir = join(proc, pid);
      await mkdir(join(pidDir, 'ns'), { recursive: true });
      await writeFile(join(pidDir, 'cgroup'), `cgroup-${pid}\n`);
      await symlink(namespace, join(pidDir, 'ns/pid'));
      await symlink(executable, join(pidDir, 'exe'));
      await writeFile(
        join(pidDir, 'status'),
        'Name:\tscanner\nUid:\t0\t0\t0\t0\n'
      );
      await writeFile(
        join(pidDir, 'stat'),
        `${pid} (scanner) ${['S', ...Array(18).fill('1'), start].join(' ')}\n`
      );
      await writeFile(processes, '10 1 scanner\n1 0 init\n');
    }
    const { stdout } = await shell(
      'RECOVERY_PROC_ROOT="$2"; RECOVERY_PROCESS_FILE="$3"; RECOVERY_SELF_PID=10; init_temp_root; trap cleanup_temp EXIT; recovery_build_scanner_ancestors; printf "%s\\n" "$RECOVERY_SCANNER_ANCESTORS"',
      [proc, processes],
      { RETIRE_OLLAMA_TEST_BIN: bin }
    );
    const entries = JSON.parse(stdout);
    assert.deepEqual(
      entries.map(({ pid, ppid, executable: evidence }) => ({
        pid,
        ppid,
        uid: evidence.uid,
      })),
      [
        { pid: '10', ppid: '1', uid: '0' },
        { pid: '1', ppid: '0', uid: '0' },
      ]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('accepts container recovery without a Docker userland proxy when inspect proves loopback binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-no-proxy-'));
  const proc = join(directory, 'proc');
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  try {
    await mkdir(join(proc, 'net'), { recursive: true });
    await Promise.all(
      ['tcp', 'tcp6'].map((name) =>
        writeFile(
          join(proc, 'net', name),
          'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
        )
      )
    );
    await writeFile(processes, '41 1 /usr/bin/ollama serve\n');
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    const { stdout } = await shell(
      'RECOVERY_PROC_ROOT="$4"; recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"uid\\":\\"1000\\",\\"startTime\\":\\"1\\"}\\n"; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$2" "$3"',
      [ports, processes, proc]
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.containerProcessCount, 1);
    assert.equal(snapshot.proxyProcessCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
