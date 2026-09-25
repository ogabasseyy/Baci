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
const childIdentity = `${childCredentials.uid ?? process.getuid?.()}:${childCredentials.gid ?? process.getgid?.()}`;

async function makeTraversable(paths, mode) {
  await Promise.all(paths.map((path) => chmod(path, mode)));
}

test('rejects wrapped Ollama fixture processes under an unprivileged identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-wrapped-'));
  const procRoot = join(directory, 'proc');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await writeFile(
      join(procRoot, 'net', 'tcp'),
      'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
    );
    await writeFile(
      join(procRoot, 'net', 'tcp6'),
      'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
    );
    await writeFile(processes, '41 1 python /opt/ollama/server.py\n');
    await makeTraversable([directory, procRoot, join(procRoot, 'net')], 0o755);
    await makeTraversable(
      [join(procRoot, 'net', 'tcp'), join(procRoot, 'net', 'tcp6'), processes],
      0o644
    );

    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; [ "$(id -u):$(id -g)" = "$RETIRE_OLLAMA_EXPECT_TEST_ID" ] || exit 79; RECOVERY_PROC_ROOT="$2"; init_temp_root; trap cleanup_temp EXIT; recovery_absent_process_snapshot "$3"`,
          'retire-ollama-recovery-wrapped-test',
          script.pathname,
          procRoot,
          processes,
        ],
        {
          env: {
            ...process.env,
            RETIRE_OLLAMA_EXPECT_TEST_ID: childIdentity,
            RETIRE_OLLAMA_PROC_ROOT: procRoot,
          },
          ...childCredentials,
        }
      ),
      (error) =>
        error.code === 78 && /foreign Ollama process remains/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const state of ['01', '08'])
  test(`rejects a generic process with a state-${state} connection to port 11434`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'baci-recovery-client-socket-')
    );
    const procRoot = join(directory, 'proc');
    const processes = join(directory, 'processes');
    try {
      await mkdir(join(procRoot, 'net'), { recursive: true });
      await mkdir(join(procRoot, '43', 'fd'), { recursive: true });
      await mkdir(join(procRoot, '43', 'net'), { recursive: true });
      await mkdir(join(procRoot, '43', 'ns'), { recursive: true });
      await symlink('socket:[23456]', join(procRoot, '43', 'fd', '7'));
      await writeFile(join(procRoot, '43', 'cgroup'), '0::/worker\n');
      await writeFile(
        join(procRoot, '43', 'status'),
        'Name:\tworker\nUid:\t1000\t1000\t1000\t1000\n'
      );
      await writeFile(
        join(procRoot, '43', 'stat'),
        `43 (worker) S ${Array.from({ length: 20 }, () => '1').join(' ')}\n`
      );
      await writeFile(join(procRoot, '43', 'ns', 'pid:[4026533000]'), '');
      await symlink('pid:[4026533000]', join(procRoot, '43', 'ns', 'pid'));
      await symlink('net:[4026534000]', join(procRoot, '43', 'ns', 'net'));
      await writeFile(
        join(procRoot, 'net', 'tcp'),
        `sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n0: 0100007F:C350 0100007F:2CAA ${state} 00000000:00000000 00:00000000 00000000 1000 0 23456\n`
      );
      await writeFile(
        join(procRoot, 'net', 'tcp6'),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      );
      await writeFile(
        join(procRoot, '43', 'net', 'tcp'),
        `sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n0: 0100007F:C350 0100007F:2CAA ${state} 00000000:00000000 00:00000000 00000000 1000 0 23456\n`
      );
      await writeFile(
        join(procRoot, '43', 'net', 'tcp6'),
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      );
      await writeFile(processes, '43 1 /usr/bin/python worker.py\n');
      await chmod(directory, 0o755);
      await Promise.all(
        [
          procRoot,
          join(procRoot, 'net'),
          join(procRoot, '43'),
          join(procRoot, '43', 'fd'),
          join(procRoot, '43', 'net'),
          join(procRoot, '43', 'ns'),
        ].map((path) => chmod(path, 0o755))
      );
      await Promise.all(
        [
          join(procRoot, 'net', 'tcp'),
          join(procRoot, 'net', 'tcp6'),
          join(procRoot, '43', 'net', 'tcp'),
          join(procRoot, '43', 'net', 'tcp6'),
          join(procRoot, '43', 'cgroup'),
          join(procRoot, '43', 'status'),
          join(procRoot, '43', 'stat'),
          processes,
        ].map((path) => chmod(path, 0o644))
      );

      await assert.rejects(
        execFileAsync(
          'sh',
          [
            '-c',
            `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_PROC_ROOT="$2"; recovery_listener_executable() { printf '%s\\n' '{"path":"/usr/bin/python","realPath":"/usr/bin/python","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","identitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","uid":"1000","startTime":"1"}'; }; init_temp_root; trap cleanup_temp EXIT; recovery_socket_snapshot "" "" "" "" "$3"`,
            'retire-ollama-recovery-client-socket-test',
            script.pathname,
            procRoot,
            processes,
          ],
          {
            env: {
              ...process.env,
              RETIRE_OLLAMA_PROC_ROOT: procRoot,
            },
            ...childCredentials,
          }
        ),
        (error) =>
          error.code === 78 && /unreviewed port-11434 client/.test(error.stderr)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('rejects a client visible only from the process network namespace', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-process-net-client-')
  );
  const procRoot = join(directory, 'proc');
  const processRoot = join(procRoot, '43');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'fd'), { recursive: true });
    await mkdir(join(processRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'ns'), { recursive: true });
    await symlink('socket:[34567]', join(processRoot, 'fd', '7'));
    await writeFile(join(processRoot, 'cgroup'), '0::/docker/client\n');
    await writeFile(
      join(processRoot, 'status'),
      'Name:\tworker\nUid:\t1000\t1000\t1000\t1000\n'
    );
    await writeFile(
      join(processRoot, 'stat'),
      `43 (worker) S ${Array.from({ length: 20 }, () => '1').join(' ')}\n`
    );
    await writeFile(join(processRoot, 'ns', 'pid:[4026533001]'), '');
    await symlink('pid:[4026533001]', join(processRoot, 'ns', 'pid'));
    await symlink('net:[4026534001]', join(processRoot, 'ns', 'net'));
    await writeFile(
      join(processRoot, 'net', 'tcp'),
      'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n0: 0100007F:C350 0100007F:2CAA 01 00000000:00000000 00:00000000 00000000 1000 0 34567\n'
    );
    for (const path of [
      join(procRoot, 'net', 'tcp'),
      join(procRoot, 'net', 'tcp6'),
      join(processRoot, 'net', 'tcp6'),
    ])
      await writeFile(
        path,
        'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
      );
    await writeFile(processes, '43 1 /usr/bin/python worker.py\n');
    await makeTraversable(
      [
        directory,
        procRoot,
        join(procRoot, 'net'),
        processRoot,
        join(processRoot, 'fd'),
        join(processRoot, 'net'),
        join(processRoot, 'ns'),
      ],
      0o755
    );
    await makeTraversable(
      [
        join(procRoot, 'net', 'tcp'),
        join(procRoot, 'net', 'tcp6'),
        join(processRoot, 'net', 'tcp'),
        join(processRoot, 'net', 'tcp6'),
        join(processRoot, 'cgroup'),
        join(processRoot, 'status'),
        join(processRoot, 'stat'),
        processes,
      ],
      0o644
    );

    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_PROC_ROOT="$2"; recovery_listener_executable() { printf '%s\\n' '{"path":"/usr/bin/python","realPath":"/usr/bin/python","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","identitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","uid":"1000","startTime":"1"}'; }; init_temp_root; trap cleanup_temp EXIT; recovery_socket_snapshot "" "" "" "" "$3"`,
          'retire-ollama-process-net-client-test',
          script.pathname,
          procRoot,
          processes,
        ],
        {
          env: { ...process.env, RETIRE_OLLAMA_PROC_ROOT: procRoot },
          ...childCredentials,
        }
      ),
      (error) =>
        error.code === 78 && /unreviewed port-11434 client/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
