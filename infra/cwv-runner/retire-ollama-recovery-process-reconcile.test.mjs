import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const childCredentials =
  process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const childIdentity = `${childCredentials.uid ?? process.getuid?.()}:${childCredentials.gid ?? process.getgid?.()}`;

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-reconcile-'));
  const procRoot = join(directory, 'proc');
  const scratch = join(directory, 'scratch');
  await chmod(directory, 0o755);
  await mkdir(join(procRoot, 'net'), { recursive: true });
  await Promise.all(
    ['tcp', 'tcp6'].map((name) =>
      writeFile(
        join(procRoot, 'net', name),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      )
    )
  );
  await chmod(procRoot, 0o755);
  await mkdir(scratch);
  if (childCredentials.uid !== undefined)
    await chown(scratch, childCredentials.uid, childCredentials.gid);
  await chmod(scratch, 0o700);
  return { directory, procRoot, scratch };
}

async function createProcess(procRoot, pid, withExecutable = false) {
  const root = join(procRoot, String(pid));
  const namespace = join(root, 'ns');
  await mkdir(namespace, { recursive: true });
  await writeFile(join(root, 'cgroup'), '0::/workers/ollama\n');
  await writeFile(join(namespace, 'pid:[4026533000]'), '');
  await symlink('pid:[4026533000]', join(namespace, 'pid'));
  await writeFile(
    join(root, 'status'),
    'Name:\tollama\nUid:\t1000\t1000\t1000\t1000\n'
  );
  await writeFile(
    join(root, 'stat'),
    `${pid} (ollama) S 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 99\n`
  );
  await writeFile(join(root, 'environ'), 'PATH=/usr/bin\0');
  const directories = [root, namespace];
  if (withExecutable) {
    const processRoot = join(root, 'root');
    const bin = join(processRoot, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'ollama'), 'ollama\n');
    await symlink('root/bin/ollama', join(root, 'exe'));
    directories.push(processRoot, bin);
  }
  await Promise.all(directories.map((path) => chmod(path, 0o755)));
}

async function grantChildDeletion(procRoot, pid) {
  if (childCredentials.uid === undefined) return;
  await Promise.all(
    [
      procRoot,
      join(procRoot, String(pid)),
      join(procRoot, String(pid), 'ns'),
    ].map((path) => chown(path, childCredentials.uid, childCredentials.gid))
  );
}

function shell(procRoot, scratch, command, args = []) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; [ "$(id -u):$(id -g)" = "$RETIRE_OLLAMA_EXPECT_TEST_ID" ] || exit 79; ${command}`,
      'retire-ollama-recovery-process-reconcile-test',
      script.pathname,
      ...args,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_EXPECT_TEST_ID: childIdentity,
        RETIRE_OLLAMA_PROC_ROOT: procRoot,
        RETIRE_OLLAMA_TMPDIR: scratch,
      },
      ...childCredentials,
    }
  );
}

test('omits a ps collector that vanished after the saved process scan', async () => {
  const fixture = await createFixture();
  const processes = join(fixture.directory, 'processes');
  const ports = join(fixture.directory, 'ports.json');
  try {
    await createProcess(fixture.procRoot, 41);
    await writeFile(
      processes,
      '41 1 /usr/bin/ollama serve\n42 1 /usr/bin/ps -eo pid=,ppid=,args=\n'
    );
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    const { stdout } = await shell(
      fixture.procRoot,
      fixture.scratch,
      'id() { printf "0\\n"; }; recovery_socket_snapshot() { RECOVERY_SOCKET_SNAPSHOT_SHA=none; RECOVERY_LISTENING_SOCKETS="[]"; }; recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"uid\\":\\"1000\\",\\"startTime\\":\\"99\\"}\\n"; }; RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; recovery_process_snapshot 41 container-cgroup container-ns "$3" "$2"',
      [processes, ports]
    );
    const snapshot = JSON.parse(stdout);
    assert.deepEqual(
      snapshot.matchingProcesses.map((entry) => entry.pid),
      ['41']
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('keeps nested proc fixture directories traversable for recovery probes', async () => {
  const fixture = await createFixture();
  const process = join(fixture.procRoot, '41');
  try {
    await createProcess(fixture.procRoot, 41, true);
    const modes = await Promise.all(
      [
        process,
        join(process, 'ns'),
        join(process, 'root'),
        join(process, 'root', 'bin'),
      ].map(async (path) => (await stat(path)).mode & 0o777)
    );
    assert.deepEqual(modes, [0o755, 0o755, 0o755, 0o755]);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('reconciles a process that disappears after the first proc-root check', async () => {
  const fixture = await createFixture();
  try {
    await createProcess(fixture.procRoot, 42);
    await grantChildDeletion(fixture.procRoot, 42);
    await rm(join(fixture.procRoot, '42', 'environ'));
    const { stdout } = await shell(
      fixture.procRoot,
      fixture.scratch,
      'id() { /bin/rm -rf -- "$RECOVERY_PROC_ROOT/42"; printf "0\\n"; }; recovery_process_environment_evidence 42'
    );
    assert.deepEqual(JSON.parse(stdout), { state: 'vanished' });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('refuses a still-present process whose environment is unavailable', async () => {
  const fixture = await createFixture();
  try {
    await createProcess(fixture.procRoot, 42);
    await rm(join(fixture.procRoot, '42', 'environ'));
    await assert.rejects(
      shell(
        fixture.procRoot,
        fixture.scratch,
        'id() { printf "0\\n"; }; recovery_process_environment_evidence 42'
      ),
      (error) =>
        error.code === 78 &&
        /process environment unavailable/.test(error.stderr)
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('reconciles disappearance before each post-environment evidence boundary', async () => {
  const boundaries = [
    'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; recovery_process_lifetime_marker() { /bin/rm -rf -- "$RECOVERY_PROC_ROOT/42"; return 1; }; recovery_process_environment_evidence 42',
    'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; temp_path() { /bin/rm -rf -- "$RECOVERY_PROC_ROOT/42"; printf "%s/matches" "$RETIRE_OLLAMA_TMPDIR"; }; recovery_process_lifetime_marker() { printf marker; }; recovery_process_environment_evidence 42',
    'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; recovery_process_lifetime_marker() { marker="$RETIRE_OLLAMA_TMPDIR/marker"; if [ -e "$marker" ]; then /bin/rm -rf -- "$RECOVERY_PROC_ROOT/42"; return 1; fi; : >"$marker"; printf marker; }; recovery_process_environment_evidence 42',
  ];
  for (const command of boundaries) {
    const fixture = await createFixture();
    try {
      await createProcess(fixture.procRoot, 42);
      await grantChildDeletion(fixture.procRoot, 42);
      const { stdout } = await shell(
        fixture.procRoot,
        fixture.scratch,
        command
      );
      assert.deepEqual(JSON.parse(stdout), { state: 'vanished' }, command);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }
});

test('skips a vanished saved process in the absent-container snapshot', async () => {
  const fixture = await createFixture();
  const processes = join(fixture.directory, 'processes');
  try {
    await writeFile(processes, '42 1 /usr/bin/ollama serve\n');
    const { stdout } = await shell(
      fixture.procRoot,
      fixture.scratch,
      'id() { printf "0\\n"; }; recovery_socket_snapshot() { RECOVERY_SOCKET_SNAPSHOT_SHA=none; RECOVERY_LISTENING_SOCKETS="[]"; }; recovery_absent_process_snapshot "$2"',
      [processes]
    );
    assert.equal(JSON.parse(stdout).state, 'absent');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('refuses failed lifetime, environment, dependency, ancestry, and process-entry digests', async () => {
  const fixture = await createFixture();
  const processes = join(fixture.directory, 'processes');
  const ports = join(fixture.directory, 'ports.json');
  try {
    await createProcess(fixture.procRoot, 41, true);
    await chmod(join(fixture.procRoot, '41', 'root', 'bin', 'ollama'), 0o755);
    await writeFile(
      join(fixture.procRoot, '41', 'environ'),
      'OLLAMA_HOST=127.0.0.1\0'
    );
    await writeFile(processes, '41 1 /usr/bin/ollama serve\n');
    await writeFile(
      ports,
      '{"HostConfig":{"PortBindings":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]}},"NetworkSettings":{"Ports":{"11434/tcp":[{"HostIp":"127.0.0.1","HostPort":"11434"}]},"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}}}\n'
    );
    for (const [command, message] of [
      [
        'recovery_process_identity() { printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"; }; hash_text() { return 1; }; recovery_process_lifetime_marker 41',
        'process environment lifetime digest failed',
      ],
      [
        'recovery_process_lifetime_marker() { printf marker; }; temp_path() { printf "%s/matches" "$RETIRE_OLLAMA_TMPDIR"; }; sha() { return 1; }; recovery_process_environment_evidence 41',
        'process environment match digest failed',
      ],
      [
        'deps="[]"; consumer_evidence="[]"; consumer_counts=$(jq -cn \'[{surface:"running-processes",matchCount:0}]\'); hash_text() { return 1; }; recovery_record_process_environment_consumer \'{"matchingEnvironmentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}\'',
        'process environment dependency digest failed',
      ],
      [
        'RECOVERY_PROCESS_FILE="$2"; RECOVERY_SELF_PID=41; recovery_process_identity() { printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n"; }; stat() { printf "1:2:1000:1000:755\\n"; }; hash_text() { return 1; }; recovery_build_scanner_ancestors',
        'scanner ancestry args digest failed',
      ],
      [
        'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; recovery_socket_snapshot() { RECOVERY_SOCKET_SNAPSHOT_SHA=none; RECOVERY_LISTENING_SOCKETS="[]"; }; recovery_process_identity() { printf "container-cgroup container-ns\\n"; }; recovery_process_executable() { printf "{\\"uid\\":\\"1000\\",\\"startTime\\":\\"99\\"}\\n"; }; hash_text() { case "$1" in "/usr/bin/ollama serve") return 1;; *) printf aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; esac; }; recovery_process_snapshot 41 container-cgroup container-ns "$3" "$2"',
        'process args digest failed',
      ],
    ]) {
      await assert.rejects(
        shell(fixture.procRoot, fixture.scratch, command, [processes, ports]),
        (error) =>
          Number(error.code) > 0 && String(error.stderr).includes(message),
        message
      );
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('refuses a failed executable identity digest before process serialization', async () => {
  const fixture = await createFixture();
  try {
    await createProcess(fixture.procRoot, 41, true);
    await assert.rejects(
      shell(
        fixture.procRoot,
        fixture.scratch,
        'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; init_temp_root; trap cleanup_temp EXIT; readlink() { case "$1" in --|-f) printf "/opt/ollama\\n";; *) return 1;; esac; }; stat() { printf "1:2:1000:1000:755\\n"; }; hash_text() { return 1; }; recovery_process_executable 41 /bin/ollama ollama'
      ),
      (error) =>
        error.code === 78 &&
        /process executable identity digest failed/.test(error.stderr)
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
