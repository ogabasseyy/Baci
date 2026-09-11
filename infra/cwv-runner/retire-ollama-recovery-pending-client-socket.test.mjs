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
const childCredentials =
  process.getuid?.() === 0 ? { gid: 65534, uid: 65534 } : {};
const header =
  'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n';
const pending =
  '0: 0100007F:C350 0100007F:2CAA 02 00000001:00000000 01:00000001 00000000 1000 0 45678\n';

async function pendingFixture(bindSocket) {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-pending-client-socket-')
  );
  const procRoot = join(directory, 'proc');
  const processRoot = join(procRoot, '43');
  const processes = join(directory, 'processes');
  await Promise.all([
    mkdir(join(procRoot, 'net'), { recursive: true }),
    mkdir(join(processRoot, 'fd'), { recursive: true }),
    mkdir(join(processRoot, 'net'), { recursive: true }),
    mkdir(join(processRoot, 'ns'), { recursive: true }),
  ]);
  const writes = [
    writeFile(join(processRoot, 'ns', 'pid:[4026533000]'), ''),
    symlink('pid:[4026533000]', join(processRoot, 'ns', 'pid')),
    symlink('net:[4026534000]', join(processRoot, 'ns', 'net')),
    writeFile(join(processRoot, 'cgroup'), '0::/worker\n'),
    writeFile(
      join(processRoot, 'status'),
      'Name:\tworker\nUid:\t1000\t1000\t1000\t1000\n'
    ),
    writeFile(
      join(processRoot, 'stat'),
      `43 (worker) S ${Array.from({ length: 20 }, () => '1').join(' ')}\n`
    ),
    writeFile(join(procRoot, 'net', 'tcp'), header + pending),
    writeFile(join(procRoot, 'net', 'tcp6'), header),
    writeFile(join(processRoot, 'net', 'tcp'), header + pending),
    writeFile(join(processRoot, 'net', 'tcp6'), header),
    writeFile(processes, '43 1 /usr/bin/python worker.py\n'),
  ];
  if (bindSocket)
    writes.push(symlink('socket:[45678]', join(processRoot, 'fd', '7')));
  await Promise.all(writes);
  await Promise.all(
    [
      directory,
      procRoot,
      join(procRoot, 'net'),
      processRoot,
      join(processRoot, 'fd'),
      join(processRoot, 'net'),
      join(processRoot, 'ns'),
    ].map((path) => chmod(path, 0o755))
  );
  await Promise.all(
    [
      join(procRoot, 'net', 'tcp'),
      join(procRoot, 'net', 'tcp6'),
      join(processRoot, 'net', 'tcp'),
      join(processRoot, 'net', 'tcp6'),
      join(processRoot, 'cgroup'),
      join(processRoot, 'status'),
      join(processRoot, 'stat'),
      processes,
    ].map((path) => chmod(path, 0o644))
  );
  return { directory, procRoot, processes };
}

function scanPending(fixture, disappear = false) {
  const mutate = disappear
    ? `awk() { for last do :; done; /usr/bin/awk "$@"; status=$?; if [ "$last" = "$RECOVERY_PROC_ROOT/43/net/tcp" ]; then : >"$RECOVERY_PROC_ROOT/net/tcp"; : >"$last"; fi; return "$status"; }; `
    : '';
  return execFileAsync(
    'sh',
    [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_PROC_ROOT="$2"; ${mutate}recovery_listener_executable() { printf '%s\\n' '{"path":"/usr/bin/python","realPath":"/usr/bin/python","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","identitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","uid":"1000","startTime":"1"}'; }; init_temp_root; trap cleanup_temp EXIT; recovery_socket_snapshot "" "" "" "" "$3"`,
      'retire-ollama-pending-client-socket-test',
      script.pathname,
      fixture.procRoot,
      fixture.processes,
    ],
    disappear
      ? { env: { ...process.env, RETIRE_OLLAMA_PROC_ROOT: fixture.procRoot } }
      : {
          env: { ...process.env, RETIRE_OLLAMA_PROC_ROOT: fixture.procRoot },
          ...childCredentials,
        }
  );
}

test('rejects a generic SYN_SENT connection to port 11434', async () => {
  const fixture = await pendingFixture(true);
  try {
    await assert.rejects(
      scanPending(fixture),
      (error) =>
        error.code === 78 && /unreviewed port-11434 client/.test(error.stderr)
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('reconciles a SYN_SENT connection that vanishes before fd binding', async () => {
  const fixture = await pendingFixture(false);
  try {
    const { stdout } = await scanPending(fixture, true);
    assert.equal(stdout, '');
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

test('rejects an unbound SYN_SENT connection that remains present', async () => {
  const fixture = await pendingFixture(false);
  try {
    await assert.rejects(
      scanPending(fixture),
      (error) =>
        error.code === 78 && /unbound port-11434 client/.test(error.stderr)
    );
  } finally {
    await rm(fixture.directory, { force: true, recursive: true });
  }
});
