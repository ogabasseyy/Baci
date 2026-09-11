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

async function provisionProcess(procRoot, pid) {
  const processRoot = join(procRoot, String(pid));
  await mkdir(join(processRoot, 'ns'), { recursive: true });
  await chmod(join(processRoot, 'ns'), 0o755);
  await writeFile(join(processRoot, 'cgroup'), '0::/workers/python\n');
  await writeFile(join(processRoot, 'ns', 'pid:[4026533000]'), '');
  await symlink('pid:[4026533000]', join(processRoot, 'ns', 'pid'));
  await writeFile(
    join(processRoot, 'status'),
    'Name:\tpython\nUid:\t1000\t1000\t1000\t1000\n'
  );
  await writeFile(
    join(processRoot, 'stat'),
    `${pid} (python) S 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 99\n`
  );
  await writeFile(
    join(processRoot, 'environ'),
    Buffer.from(
      'PRIVATE_TOKEN=must-not-appear\0OLLAMA_HOST=http://127.0.0.1:11434\0'
    )
  );
  await chmod(processRoot, 0o755);
}

async function provisionScratch(directory) {
  const scratch = join(directory, 'scratch');
  await mkdir(scratch);
  if (childCredentials.uid !== undefined)
    await chown(scratch, childCredentials.uid, childCredentials.gid);
  await chmod(scratch, 0o700);
  return scratch;
}

function shell(procRoot, processes, scratch, command) {
  return execFileAsync(
    'sh',
    [
      '-c',
      `RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; [ "$(id -u):$(id -g)" = "$RETIRE_OLLAMA_EXPECT_TEST_ID" ] || exit 79; init_temp_root; trap cleanup_temp EXIT; ${command}`,
      'retire-ollama-recovery-process-environment-test',
      script.pathname,
      processes,
    ],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_PROC_ROOT: procRoot,
        RETIRE_OLLAMA_TMPDIR: scratch,
        RETIRE_OLLAMA_EXPECT_TEST_ID: childIdentity,
      },
      ...childCredentials,
    }
  );
}

test('keeps the privileged recovery proc root canonical', async () => {
  const { stdout } = await execFileAsync('sh', [
    '-c',
    'RETIRE_OLLAMA_TEST_BIN=/sbin; RETIRE_OLLAMA_TEST_FSTYPE=apfs; . "$1"; SCRIPT_DIR=$(dirname "$1"); . "$SCRIPT_DIR/retire-ollama-recovery.sh"; recovery_proc_root_for_uid 0 /unsafe-test-proc',
    'retire-ollama-recovery-process-environment-test',
    script.pathname,
  ]);
  assert.equal(stdout, '/proc');
});

test('rejects an unmanaged idle client found only in a lifetime-bound proc environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-recovery-environ-'));
  const procRoot = join(directory, 'proc');
  const processes = join(directory, 'processes');
  try {
    await chmod(directory, 0o755);
    const scratch = await provisionScratch(directory);
    await mkdir(join(procRoot, 'net'), { recursive: true });
    await chmod(procRoot, 0o755);
    await Promise.all(
      ['tcp', 'tcp6'].map((name) =>
        writeFile(
          join(procRoot, 'net', name),
          'sl local_address rem_address st tx_queue tr tm->when retrnsmt uid timeout inode\n'
        )
      )
    );
    await provisionProcess(procRoot, 41);
    await writeFile(processes, '41 1 /usr/bin/python /opt/worker.py\n');

    await assert.rejects(
      shell(
        procRoot,
        processes,
        scratch,
        'consumer_counts=$(jq -cn \'[{surface:"running-processes",matchCount:0}]\'); recovery_absent_process_snapshot "$2"'
      ),
      (error) => {
        assert.equal(error.code, 78);
        assert.match(error.stderr, /foreign Ollama process remains/);
        assert.doesNotMatch(error.stderr, /PRIVATE_TOKEN|127\.0\.0\.1/);
        return true;
      }
    );

    const { stdout } = await shell(
      procRoot,
      processes,
      scratch,
      'review_required() { :; }; deps="[]"; consumer_counts=$(jq -cn \'[{surface:"running-processes",matchCount:0}]\'); consumer_evidence="[]"; recovery_absent_process_snapshot "$2" >/dev/null; jq -cn --argjson deps "$deps" --argjson counts "$consumer_counts" --argjson evidence "$consumer_evidence" \'{deps:$deps,counts:$counts,evidence:$evidence}\''
    );
    const inventory = JSON.parse(stdout);
    assert.equal(inventory.counts[0].matchCount, 1);
    assert.match(inventory.deps[0]['source-path-sha256'], /^[a-f0-9]{64}$/);
    assert.match(inventory.evidence[0].classifiedPathSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(inventory.deps[0]['key-name'], /41/);
    assert.doesNotMatch(stdout, /PRIVATE_TOKEN|127\.0\.0\.1|OLLAMA_HOST/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses environment evidence when the process lifetime changes during the read', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-recovery-environ-race-')
  );
  const procRoot = join(directory, 'proc');
  const processes = join(directory, 'processes');
  try {
    await chmod(directory, 0o755);
    const scratch = await provisionScratch(directory);
    await mkdir(procRoot);
    await chmod(procRoot, 0o755);
    await provisionProcess(procRoot, 41);
    await writeFile(processes, '41 1 /usr/bin/python /opt/worker.py\n');
    await assert.rejects(
      shell(
        procRoot,
        processes,
        scratch,
        'recovery_process_lifetime_marker() { marker="$RETIRE_OLLAMA_TMPDIR/lifetime"; if [ -e "$marker" ]; then printf after; else : >"$marker"; printf before; fi; }; recovery_process_environment_evidence 41'
      ),
      (error) =>
        error.code === 78 &&
        /process environment lifetime changed/.test(error.stderr)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
