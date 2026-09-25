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
const header =
  'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n';

test('normal inventory rejects a generic process connected to port 11434', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-destructive-client-socket-')
  );
  const procRoot = join(directory, 'proc');
  const processRoot = join(procRoot, '43');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'fd'), { recursive: true });
    await mkdir(join(processRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'ns'), { recursive: true });
    await symlink('socket:[23456]', join(processRoot, 'fd', '7'));
    await symlink('net:[4026534000]', join(processRoot, 'ns', 'net'));
    await writeFile(
      join(procRoot, 'net', 'tcp'),
      `${header}0: 0100007F:C350 0100007F:2CAA 01 00000000:00000000 00:00000000 00000000 1000 0 23456\n`
    );
    await writeFile(join(procRoot, 'net', 'tcp6'), header);
    await writeFile(
      join(processRoot, 'net', 'tcp'),
      `${header}0: 0100007F:C350 0100007F:2CAA 01 00000000:00000000 00:00000000 00000000 1000 0 23456\n`
    );
    await writeFile(join(processRoot, 'net', 'tcp6'), header);
    await writeFile(
      processes,
      'PID PPID USER COMMAND\n43 1 app /usr/bin/python worker.py\n'
    );
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
        processes,
      ].map((path) => chmod(path, 0o644))
    );

    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_PROC_ROOT="$2"; recovery_process_lifetime_marker() { printf '%s\\n' stable; }; recovery_listener_executable() { printf '%s\\n' '{"path":"/usr/bin/python","realPath":"/usr/bin/python","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","identitySha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","uid":"1000","startTime":"1"}'; }; init_temp_root; trap cleanup_temp EXIT; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; record_running_process_sockets "$3"`,
        'retire-ollama-destructive-client-socket-test',
        script.pathname,
        procRoot,
        processes,
      ]),
      (error) =>
        error.code === 78 && /unreviewed port-11434 client/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('normal client inventory records the Ollama service listener without rejecting it', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-destructive-approved-listener-')
  );
  const procRoot = join(directory, 'proc');
  const processRoot = join(procRoot, '42');
  const processes = join(directory, 'processes');
  try {
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'fd'), { recursive: true });
    await mkdir(join(processRoot, 'net'), { recursive: true });
    await mkdir(join(processRoot, 'ns'), { recursive: true });
    await symlink('socket:[34567]', join(processRoot, 'fd', '8'));
    await symlink('net:[4026534001]', join(processRoot, 'ns', 'net'));
    const listener = `${header}0: 0100007F:2CAA 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 34567\n`;
    for (const path of [
      join(procRoot, 'net', 'tcp'),
      join(processRoot, 'net', 'tcp'),
    ])
      await writeFile(path, listener);
    for (const path of [
      join(procRoot, 'net', 'tcp6'),
      join(processRoot, 'net', 'tcp6'),
    ])
      await writeFile(path, header);
    await writeFile(
      processes,
      'PID PPID USER COMMAND\n42 1 ollama /usr/bin/ollama serve\n'
    );
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
        processes,
      ].map((path) => chmod(path, 0o644))
    );

    const { stdout } = await execFileAsync('sh', [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; RECOVERY_PROC_ROOT="$2"; recovery_process_lifetime_marker() { printf '%s\\n' stable; }; init_temp_root; trap cleanup_temp EXIT; records='[]'; deps='[]'; consumer_counts='[]'; consumer_evidence='[]'; record_running_process_sockets "$3"; printf '%s\\n' "$records"`,
      'retire-ollama-approved-listener-test',
      script.pathname,
      procRoot,
      processes,
    ]);
    const records = JSON.parse(stdout);
    assert.equal(records.length, 1);
    assert.equal(records[0].class, 'running-process-sockets');
    assert.equal(
      records[0].sha256,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
