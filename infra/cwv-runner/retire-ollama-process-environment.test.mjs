import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  chown,
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

async function provisionProcess(procRoot, pid, environment) {
  const processRoot = join(procRoot, String(pid));
  const namespace = join(processRoot, 'ns');
  await mkdir(namespace, { recursive: true });
  await Promise.all([
    writeFile(join(processRoot, 'cgroup'), '0::/workers/python\n'),
    writeFile(join(namespace, 'pid:[4026533000]'), ''),
    writeFile(
      join(processRoot, 'status'),
      'Name:\tpython\nUid:\t1000\t1000\t1000\t1000\n'
    ),
    writeFile(
      join(processRoot, 'stat'),
      `${pid} (python) S 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 99\n`
    ),
    writeFile(join(processRoot, 'environ'), Buffer.from(environment)),
  ]);
  await symlink('pid:[4026533000]', join(namespace, 'pid'));
  await Promise.all([processRoot, namespace].map((path) => chmod(path, 0o755)));
}

test('classifies a generic live process whose lifetime-bound environment references Ollama', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-process-environment-'));
  const procRoot = join(directory, 'proc');
  const scratch = join(directory, 'scratch');
  const processes = join(directory, 'processes');
  try {
    await chmod(directory, 0o755);
    await Promise.all([mkdir(procRoot), mkdir(scratch)]);
    if (childCredentials.uid !== undefined)
      await chown(scratch, childCredentials.uid, childCredentials.gid);
    await Promise.all([chmod(procRoot, 0o755), chmod(scratch, 0o700)]);
    await provisionProcess(
      procRoot,
      41,
      'PRIVATE_TOKEN=must-not-appear\0OLLAMA_HOST=http://127.0.0.1:11434\0'
    );
    await writeFile(processes, '41 1 worker /usr/bin/python /opt/worker.py\n');

    const { stdout, stderr } = await execFileAsync(
      'sh',
      [
        '-c',
        'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; [ "$(id -u):$(id -g)" = "$RETIRE_OLLAMA_EXPECT_TEST_ID" ] || exit 79; init_temp_root; trap cleanup_temp EXIT; deps="[]"; consumer_counts=$(jq -cn \'[{surface:"running-processes",matchCount:0}]\'); consumer_evidence="[]"; record_running_process_environments "$2"; printf "%s\\n%s\\n%s\\n" "$consumer_counts" "$consumer_evidence" "$deps"',
        'retire-ollama-process-environment-test',
        script.pathname,
        processes,
      ],
      {
        ...childCredentials,
        env: {
          ...process.env,
          RETIRE_OLLAMA_EXPECT_TEST_ID: childIdentity,
          RETIRE_OLLAMA_PROC_ROOT: procRoot,
          RETIRE_OLLAMA_TMPDIR: scratch,
        },
      }
    );
    const [counts, evidence, dependencies] = stdout
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(counts, [{ surface: 'running-processes', matchCount: 1 }]);
    assert.equal(evidence.length, 1);
    assert.equal(dependencies.length, 1);
    assert.doesNotMatch(`${stdout}${stderr}`, /PRIVATE_TOKEN|127\.0\.0\.1/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fails closed when a saved generic process lacks lifetime evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-process-lifetime-'));
  const procRoot = join(directory, 'proc');
  const scratch = join(directory, 'scratch');
  const processes = join(directory, 'processes');
  try {
    await chmod(directory, 0o755);
    await Promise.all([mkdir(procRoot), mkdir(scratch)]);
    if (childCredentials.uid !== undefined)
      await chown(scratch, childCredentials.uid, childCredentials.gid);
    await Promise.all([chmod(procRoot, 0o755), chmod(scratch, 0o700)]);
    await provisionProcess(procRoot, 42, 'OLLAMA_HOST=disabled\0');
    await rm(join(procRoot, '42', 'cgroup'));
    await writeFile(processes, '42 1 worker /usr/bin/python /opt/worker.py\n');

    await assert.rejects(
      execFileAsync(
        'sh',
        [
          '-c',
          'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; init_temp_root; trap cleanup_temp EXIT; deps="[]"; consumer_counts=$(jq -cn \'[{surface:"running-processes",matchCount:0}]\'); consumer_evidence="[]"; record_running_process_environments "$2"',
          'retire-ollama-process-environment-test',
          script.pathname,
          processes,
        ],
        {
          ...childCredentials,
          env: {
            ...process.env,
            RETIRE_OLLAMA_PROC_ROOT: procRoot,
            RETIRE_OLLAMA_TMPDIR: scratch,
          },
        }
      ),
      (error) => {
        assert.equal(error.code, 78);
        assert.match(error.stderr, /process environment lifetime unavailable/);
        assert.doesNotMatch(error.stderr, /OLLAMA_HOST/);
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
