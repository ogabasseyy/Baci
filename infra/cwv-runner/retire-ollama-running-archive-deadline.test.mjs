import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('./retire-ollama.sh', import.meta.url);
const fixtureTimeoutMs = 15_000;

async function runDeadlineFixture(deadline, command) {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-deadline-')
  );
  const marker = join(directory, 'worker-parser-called');
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; load_consumer_scanners; ${command}`,
        'running-archive-deadline-test',
        script.pathname,
        directory,
        deadline,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          RETIRE_TEST_MARKER: marker,
        },
        timeout: fixtureTimeoutMs,
      }
    );
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const invalidDeadlineCommand =
  'running_container_worker_pid() { : >"$RETIRE_TEST_MARKER"; return 2; }; if running_container_wait_group "$3" group:invalid -- "$2/status"; then exit 90; else status=$?; fi; [ "$status" -eq 2 ] || exit 91; [ ! -e "$RETIRE_TEST_MARKER" ] || exit 92; printf \'%s\\n\' rejected';

test('rejects an empty deadline before worker parsing', async () => {
  assert.equal(
    await runDeadlineFixture('', invalidDeadlineCommand),
    'rejected\n'
  );
});

test('rejects a nonnumeric deadline before worker parsing', async () => {
  assert.equal(
    await runDeadlineFixture('not-a-number', invalidDeadlineCommand),
    'rejected\n'
  );
});

test('accepts a numeric deadline and completes a ready worker group', async () => {
  const output = await runDeadlineFixture(
    '2',
    'status="$2/status"; printf \'0\\n\' >"$status"; running_container_now() { printf \'1\\n\'; }; running_container_wait_group "$3" -- "$status"; printf \'%s\\n\' accepted'
  );
  assert.equal(output, 'accepted\n');
});
