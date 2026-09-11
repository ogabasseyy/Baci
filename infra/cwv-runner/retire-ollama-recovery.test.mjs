import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function shell(command, args = [], env = {}) {
  const procRoot = await mkdtemp(join(tmpdir(), 'baci-recovery-proc-'));
  const bin = await testBin();
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
      'retire-ollama-recovery-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_PROC_ROOT: procRoot,
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        ...env,
      },
    }
  ).finally(() =>
    Promise.all([
      rm(procRoot, { recursive: true, force: true }),
      rm(bin, { recursive: true, force: true }),
    ])
  );
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

test('records explicit absent sentinels when the package and units no longer exist', async () => {
  const { stdout } = await shell(
    'recovery_dpkg_query() { return 1; }; recovery_systemctl() { return 4; }; init_temp_root; trap cleanup_temp EXIT; recovery_package_snapshot; recovery_unit_snapshot ollama.service'
  );
  const [packageSnapshot, unitSnapshot] = stdout
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.deepEqual(packageSnapshot, {
    name: 'ollama',
    state: 'absent',
    version: null,
  });
  assert.deepEqual(unitSnapshot, { name: 'ollama.service', state: 'absent' });
});

test('binds model deletion to both store and non-writable parent identities', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-model-')
  );
  const store = join(directory, 'models');
  const bin = await testBin();
  try {
    await mkdir(store);
    await writeFile(join(store, 'model.bin'), 'model bytes');
    const { stdout } = await shell(
      'STORE="$2"; init_temp_root; trap cleanup_temp EXIT; recovery_model_snapshot',
      [store],
      { RETIRE_OLLAMA_TEST_BIN: bin }
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.realPath, store);
    assert.equal(snapshot.parent.realPath, dirname(store));
    assert.equal(snapshot.parent.mode, '700');
    assert.match(snapshot.treeSha256, /^[0-9a-f]{64}$/);
    assert.match(snapshot.mountSha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  }
});

test('emits a whole-crontab digest and duplicate-preserving line multiset', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-ollama-recovery-cron-'));
  const cron = join(directory, 'cron');
  const contents = '0 * * * * alpha\n5 * * * * beta\n0 * * * * alpha\n';
  try {
    await writeFile(cron, contents);
    const { stdout } = await shell(
      'init_temp_root; trap cleanup_temp EXIT; recovery_cron_snapshot "$2"',
      [cron]
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.wholeSha256, sha(contents));
    assert.equal(snapshot.lineCount, 3);
    assert.deepEqual(
      snapshot.lines,
      [
        { sha256: sha('0 * * * * alpha'), count: 2 },
        { sha256: sha('5 * * * * beta'), count: 1 },
      ].sort((left, right) => left.sha256.localeCompare(right.sha256))
    );
    assert.doesNotMatch(stdout, /alpha|beta/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a relevant process that is neither the reviewed container nor its proxy', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-process-')
  );
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  try {
    await writeFile(
      processes,
      '41 1 ollama serve\n42 1 /usr/local/bin/unknown 11434\n'
    );
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    await assert.rejects(
      shell(
        'recovery_process_identity() { case "$1" in 41) printf "container-cgroup container-ns\\n";; *) printf "foreign-cgroup foreign-ns\\n";; esac; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/%s\\",\\"sha256\\":\\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\",\\"identitySha256\\":\\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\",\\"uid\\":\\"0\\",\\"startTime\\":\\"1\\",\\"expected\\":\\"%s\\"}\\n" "$2" "$2"; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 40 container-cgroup container-ns "$2" "$3"',
        [ports, processes]
      ),
      (error) =>
        error.code === 78 && /foreign Ollama process/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds an ollama process and host docker-proxy to one reviewed container port', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-ollama-recovery-process-')
  );
  const processes = join(directory, 'processes');
  const ports = join(directory, 'ports.json');
  try {
    await writeFile(
      processes,
      '41 1 /usr/bin/ollama serve\n42 1 /usr/bin/docker-proxy -proto tcp -host-ip 127.0.0.1 -host-port 11434 -container-ip 172.17.0.2 -container-port 11434\n'
    );
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    const { stdout } = await shell(
      'recovery_process_identity() { case "$1" in 41) printf "container-cgroup container-ns\\n";; 42) printf "proxy-cgroup proxy-ns\\n";; esac; }; recovery_process_executable() { printf "{\\"path\\":\\"/usr/bin/%s\\",\\"sha256\\":\\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\",\\"identitySha256\\":\\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\",\\"uid\\":\\"0\\",\\"startTime\\":\\"1\\",\\"expected\\":\\"%s\\"}\\n" "$2" "$2"; }; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$2" "$3"',
      [ports, processes]
    );
    const snapshot = JSON.parse(stdout);
    assert.equal(snapshot.containerProcessCount, 1);
    assert.equal(snapshot.proxyProcessCount, 1);
    assert.deepEqual(
      snapshot.matchingProcesses.map(({ class: kind, binding }) => [
        kind,
        binding,
      ]),
      [
        ['ollama-process', 'container'],
        ['docker-proxy', 'container-port-11434/tcp'],
      ]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses one immutable inspect JSON and rejects a mutable tag as image identity', async () => {
  const valid = JSON.stringify({
    Name: '/ollama-loopback',
    Id: 'b'.repeat(64),
    Image: `sha256:${'c'.repeat(64)}`,
    State: { Running: true, Pid: 4242 },
    Path: '/bin/ollama',
    Config: { Env: ['TOKEN=not-for-receipt'] },
    HostConfig: { PortBindings: { '11434/tcp': [{ HostPort: '11434' }] } },
    Mounts: [],
    NetworkSettings: { Networks: {} },
  });
  const { stdout } = await shell(
    `recovery_docker() { printf '%s\\n' '${valid}'; }; recovery_process_identity() { printf 'container-cgroup container-ns\\n'; }; init_temp_root; trap cleanup_temp EXIT; recovery_container_snapshot`
  );
  const snapshot = JSON.parse(stdout);
  assert.equal(snapshot.fullId, 'b'.repeat(64));
  assert.equal(snapshot.imageId, `sha256:${'c'.repeat(64)}`);
  assert.match(snapshot.configSha256, /^[0-9a-f]{64}$/);
  const tagged = valid.replace(
    `sha256:${'c'.repeat(64)}`,
    'registry.example/ollama:0.5'
  );
  await assert.rejects(
    shell(
      `recovery_docker() { printf '%s\\n' '${tagged}'; }; recovery_process_identity() { printf 'container-cgroup container-ns\\n'; }; init_temp_root; trap cleanup_temp EXIT; recovery_container_snapshot`
    ),
    (error) => /invalid recovery container snapshot/.test(error.stderr)
  );
});
