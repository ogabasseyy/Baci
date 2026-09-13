import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);

async function testBin() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-sudo-bin-'));
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
    `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),i=a.indexOf('-c'),f=i>=0?a[i+1]:a.find(v=>v.startsWith('--format='))?.slice(9),p=a.at(-1),s=(a.includes('-L')||a.includes('-Lc')?fs.statSync:fs.lstatSync)(p),m=s.mode&0o7777;process.stdout.write((f??'%a').replaceAll('%u',String(s.uid)).replaceAll('%g',String(s.gid)).replaceAll('%a',m.toString(8)).replaceAll('%d',String(s.dev)).replaceAll('%i',String(s.ino))+'\\n');\n`
  );
  await Promise.all(
    ['sha256sum', 'readlink', 'stat'].map((name) =>
      chmod(join(directory, name), 0o755)
    )
  );
  return directory;
}

function shell(command, args, env) {
  const testBin = env?.RETIRE_OLLAMA_TEST_BIN;
  return execFileAsync(
    'sh',
    [
      '-c',
      `. "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; ${command}`,
      'recovery-sudo-ancestor-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...(testBin ? {} : { RETIRE_OLLAMA_TEST_BIN: '/usr/bin' }),
        ...env,
      },
    }
  );
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-sudo-'));
  const proc = join(directory, 'proc');
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  const scanner = join(directory, 'scanner');
  const init = join(directory, 'init');
  const namespace = join(directory, 'namespace');
  await Promise.all([
    writeFile(scanner, 'scanner'),
    writeFile(init, 'init'),
    writeFile(namespace, 'namespace'),
    writeFile(
      processes,
      `50 1 /usr/bin/ollama serve\n100 99 /bin/sh ${script.pathname} --recovery-scan\n99 1 /usr/bin/sudo ${script.pathname} --recovery-scan\n1 0 init\n`
    ),
    writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    ),
  ]);
  await Promise.all([chmod(scanner, 0o755), chmod(init, 0o755)]);
  for (const [pid, executable] of [
    ['100', scanner],
    ['99', '/usr/bin/sudo'],
    ['1', init],
  ]) {
    const root = join(proc, pid);
    await mkdir(join(root, 'ns'), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'status'), 'Name:\ttest\nUid:\t0\t0\t0\t0\n'),
      writeFile(
        join(root, 'stat'),
        `${pid} (test) S ${Array(19).fill('1').join(' ')}\n`
      ),
      writeFile(join(root, 'cgroup'), `cgroup-${pid}\n`),
      writeFile(
        join(root, 'cmdline'),
        pid === '100'
          ? `/bin/sh\0${script.pathname}\0--recovery-scan\0`
          : pid === '99'
            ? `/usr/bin/sudo\0${script.pathname}\0--recovery-scan\0`
            : 'init\0'
      ),
      symlink(namespace, join(root, 'ns/pid')),
      symlink(executable, join(root, 'exe')),
    ]);
  }
  return { directory, proc, processes, ports };
}

const common =
  'recovery_socket_snapshot() { RECOVERY_SOCKET_SNAPSHOT_SHA=none; RECOVERY_LISTENING_SOCKETS="[]"; }; recovery_process_environment_evidence() { printf "{}\\n"; }; recovery_process_identity() { case "$1" in 50) printf "container-cgroup container-ns\\n";; *) printf "ancestor-cgroup ancestor-ns\\n";; esac; }; sha() { printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"; }; recovery_process_executable() { printf \'{"uid":"1000","path":"/usr/bin/ollama","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","identitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","startTime":"1"}\\n\'; }; init_temp_root; trap cleanup_temp EXIT;';

test('permits only the canonical direct sudo scanner parent in running and absent snapshots', async () => {
  const value = await fixture();
  const bin = await testBin();
  try {
    const env = {
      RETIRE_OLLAMA_PROC_ROOT: value.proc,
      RETIRE_OLLAMA_TEST_BIN: bin,
    };
    const running = await shell(
      `${common} RECOVERY_SELF_PID=100; recovery_process_snapshot 50 container-cgroup container-ns "$2" "$3"`,
      [value.ports, value.processes],
      env
    );
    assert.equal(JSON.parse(running.stdout).containerProcessCount, 1);
    await writeFile(
      value.processes,
      `100 99 /bin/sh ${script.pathname} --recovery-scan\n99 1 sudo ${script.pathname} --recovery-scan\n1 0 init\n`
    );
    const absent = await shell(
      `${common} RECOVERY_SELF_PID=100; recovery_absent_process_snapshot "$2"`,
      [value.processes],
      env
    );
    assert.equal(JSON.parse(absent.stdout).state, 'absent');
  } finally {
    await rm(value.directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('rejects sudo scanner lookalikes outside the exact direct-parent invocation', async () => {
  const value = await fixture();
  const bin = await testBin();
  try {
    const env = {
      RETIRE_OLLAMA_PROC_ROOT: value.proc,
      RETIRE_OLLAMA_TEST_BIN: bin,
    };
    for (const command of [
      `recovery_is_reviewed_scanner_command 1 sudo /usr/bin/sudo " ${script.pathname} --recovery-scan"`,
      `recovery_is_reviewed_scanner_command 99 sudo /usr/bin/sudo " -- ${script.pathname} --recovery-scan"`,
      `recovery_is_reviewed_scanner_command 99 sudo /usr/bin/sudo " ${script.pathname} --recovery-scan extra"`,
      `recovery_is_reviewed_scanner_command 99 sudo /opt/sudo " ${script.pathname} --recovery-scan"`,
    ]) {
      const result = await shell(
        `${common} RECOVERY_SELF_PID=100; RECOVERY_PROCESS_FILE="$2"; recovery_build_scanner_ancestors; ${command}`,
        [value.processes],
        env
      ).then(
        () => 0,
        (error) => error.code
      );
      assert.notEqual(result, 0);
    }
    const fakeSudo = join(value.directory, 'sudo-spoof');
    await writeFile(fakeSudo, 'sudo-spoof');
    await chmod(fakeSudo, 0o755);
    await unlink(join(value.proc, '99', 'exe'));
    await symlink(fakeSudo, join(value.proc, '99', 'exe'));
    const result = await shell(
      `${common} RECOVERY_SELF_PID=100; RECOVERY_PROCESS_FILE="$2"; recovery_build_scanner_ancestors; recovery_is_reviewed_scanner_command 99 sudo /usr/bin/sudo " ${script.pathname} --recovery-scan"`,
      [value.processes],
      env
    ).then(
      () => 0,
      (error) => error.code
    );
    assert.notEqual(result, 0);
  } finally {
    await rm(value.directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('refuses a running container process whose executable evidence omits uid', async () => {
  const value = await fixture();
  try {
    await writeFile(value.processes, '50 1 /usr/bin/ollama serve\n');
    await assert.rejects(
      shell(
        `${common} recovery_process_executable() { printf '{"path":"/usr/bin/ollama"}\\n'; }; recovery_process_snapshot 50 container-cgroup container-ns "$2" "$3"`,
        [value.ports, value.processes],
        { RETIRE_OLLAMA_PROC_ROOT: value.proc }
      ),
      (error) =>
        error.code === 78 &&
        /container process uid unavailable/.test(error.stderr)
    );
  } finally {
    await rm(value.directory, { recursive: true, force: true });
  }
});
