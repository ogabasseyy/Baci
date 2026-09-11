import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
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

async function runFixture(command, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-archive-'));
  try {
    const { stdout } = await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; load_consumer_scanners; ${command}`,
        'running-archive-test',
        script.pathname,
        directory,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_BIN: '/usr/bin',
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          ...env,
        },
      }
    );
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('keeps enforcing the deadline after archive output is complete', async () => {
  await assert.rejects(
    runFixture(
      'status="$2/status"; clock="$2/clock"; printf \'0\\n\' >"$status"; sleep 3 & sleeper=$!; running_container_now() { if [ -e "$clock" ]; then printf \'3\\n\'; else : >"$clock"; printf \'1\\n\'; fi; }; running_container_wait_group 2 "$sleeper" -- "$status"'
    ),
    (error) => error.code === 124
  );
});
test('kills a fake Docker descendant when an archive save times out', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-descendant-')
  );
  const bin = join(directory, 'bin');
  const childPid = join(directory, 'child.pid');
  const docker = join(bin, 'docker');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    docker,
    `#!/bin/sh
[ "$1" = --host ] && [ "$3" = image ] && [ "$4" = save ] && [ "$#" -eq 5 ] || exit 93
/bin/sleep 30 &
child=$!
printf '%s\n' "$child" >"$RETIRE_TEST_CHILD_PID"
trap '' TERM
wait "$child"
`,
    { mode: 0o700 }
  );
  await chmod(docker, 0o700);

  try {
    const result = await execFileAsync(
      'sh',
      [
        '-c',
        `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; load_consumer_scanners; output=$(temp_path); fifo=$(temp_path); status=$(temp_path); running_container_now() { [ -s "$RETIRE_TEST_CHILD_PID" ] && printf '2\\n' || printf '0\\n'; }; if running_container_archive_save_bounded image "${'a'.repeat(64)}" "$output" "$fifo" "$status" 1; then exit 90; else archive_status=$?; fi; [ "$archive_status" -eq 2 ] || exit 91; child=$(cat "$RETIRE_TEST_CHILD_PID"); attempt=0; while [ "$attempt" -lt 20 ] && kill -0 "$child" 2>/dev/null; do attempt=$((attempt + 1)); /bin/sleep 0.05; done; if kill -0 "$child" 2>/dev/null; then kill -KILL "$child" 2>/dev/null || :; exit 92; fi; printf 'cleaned\\n'`,
        'running-archive-descendant-test',
        script.pathname,
        directory,
      ],
      {
        env: {
          ...process.env,
          RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
          RETIRE_OLLAMA_TEST_BIN: bin,
          RETIRE_TEST_CHILD_PID: childPid,
        },
        timeout: 15_000,
      }
    );
    assert.equal(result.stdout, 'cleaned\n');
  } finally {
    try {
      const pid = Number.parseInt(await readFile(childPid, 'utf8'), 10);
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // The archive worker may already have cleaned up the descendant.
    }
    await rm(directory, { recursive: true, force: true });
  }
});
test('creates the archive worker process group before opening a blocking FIFO', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-process-group-')
  );
  const bin = join(directory, 'bin');
  const docker = join(bin, 'docker');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(docker, '#!/bin/sh\nexit 91\n', { mode: 0o700 });
  try {
    const output = await runFixture(
      `fifo="$2/archive.fifo"; /usr/bin/mkfifo "$fifo"; running_container_archive_group_start image "${'a'.repeat(64)}" "$fifo" || exit 90; worker=$(running_container_worker_pid "$RUNNING_CONTAINER_ARCHIVE_WORKER") || exit 91; pgid=$(/bin/ps -o pgid= -p "$worker" | /usr/bin/tr -d '[:space:]'); [ "$pgid" = "$worker" ] || exit 93; /bin/cat "$fifo" >/dev/null & reader=$!; if wait "$worker"; then worker_status=0; else worker_status=$?; fi; wait "$reader" || exit 94; [ "$worker_status" -eq 91 ] || exit 95; bad="$2/not-a-fifo"; : >"$bad"; if running_container_archive_group_start image "${'a'.repeat(64)}" "$bad"; then worker=$(running_container_worker_pid "$RUNNING_CONTAINER_ARCHIVE_WORKER") || exit 97; if wait "$worker"; then startup_status=0; else startup_status=$?; fi; else startup_status=$?; fi; [ "$startup_status" -eq 2 ] || exit 98; printf 'grouped\\n'`,
      { RETIRE_OLLAMA_TEST_BIN: bin }
    );
    assert.equal(output, 'grouped\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('refuses archive when the unprivileged test Docker executable is absent', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-no-docker-')
  );
  const bin = join(directory, 'bin');
  const marker = join(directory, 'path-docker-used');
  await mkdir(bin, { mode: 0o700 });
  try {
    const output = await runFixture(
      'docker() { : >"$RETIRE_TEST_MARKER"; return 0; }; if running_container_archive_group_start image ' +
        '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ' +
        '"$(temp_path)"; then exit 90; else status=$?; fi; [ "$status" -eq 2 ] || exit 91; [ ! -e "$RETIRE_TEST_MARKER" ] || exit 92; printf \'%s\\n\' refused',
      { RETIRE_OLLAMA_TEST_BIN: bin, RETIRE_TEST_MARKER: marker }
    );
    assert.equal(output, 'refused\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('runs archive commands through the validated test Docker path', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-pinned-docker-')
  );
  const bin = join(directory, 'bin');
  const docker = join(bin, 'docker');
  const log = join(directory, 'docker.log');
  const marker = join(directory, 'shell-docker-used');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    docker,
    `#!/bin/sh
printf '%s\\n' "$*" >"$RETIRE_TEST_DOCKER_LOG"
printf 'archive\\n'
`,
    { mode: 0o700 }
  );
  try {
    const output = await runFixture(
      'docker() { : >"$RETIRE_TEST_SHELL_DOCKER"; return 91; }; running_container_archive_command image ' +
        '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_TEST_DOCKER_LOG: log,
        RETIRE_TEST_SHELL_DOCKER: marker,
      }
    );
    assert.equal(output, 'archive\n');
    assert.match(
      await readFile(log, 'utf8'),
      /--host unix:\/\/\/run\/docker\.sock image save a{64}/
    );
    await assert.rejects(readFile(marker));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('rejects missing or replaced archive FIFOs and closes a validated FIFO', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-fifo-validation-')
  );
  const bin = join(directory, 'bin');
  const docker = join(bin, 'docker');
  const missing = join(directory, 'missing-fifo');
  const replaced = join(directory, 'replaced-fifo');
  const replacement = join(directory, 'replacement-target');
  const valid = join(directory, 'valid-fifo');
  const capture = join(directory, 'capture');
  await mkdir(bin, { mode: 0o700 });
  await writeFile(docker, "#!/bin/sh\nprintf 'archive\\n'\n", { mode: 0o700 });
  await writeFile(replacement, 'not a fifo\n');
  await execFileAsync('/usr/bin/mkfifo', [replaced, valid]);
  await rm(replaced);
  await symlink(replacement, replaced);
  try {
    const output = await runFixture(
      `check_bad_fifo() { if running_container_archive_group_start image "${'a'.repeat(64)}" "$1"; then worker=$(running_container_worker_pid "$RUNNING_CONTAINER_ARCHIVE_WORKER") || return 4; wait "$worker"; status=$?; else status=$?; fi; [ "$status" -eq 2 ]; }; check_bad_fifo "$RETIRE_TEST_MISSING" || exit 90; check_bad_fifo "$RETIRE_TEST_REPLACED" || exit 91; /bin/cat "$RETIRE_TEST_VALID" >"$RETIRE_TEST_CAPTURE" & reader=$!; running_container_archive_group_start image "${'a'.repeat(64)}" "$RETIRE_TEST_VALID" || exit 92; worker=$(running_container_worker_pid "$RUNNING_CONTAINER_ARCHIVE_WORKER") || exit 93; wait "$worker"; worker_status=$?; wait "$reader"; reader_status=$?; [ "$worker_status" -eq 0 ] && [ "$reader_status" -eq 0 ] || exit 94; printf '%s\\n' "$(cat "$RETIRE_TEST_CAPTURE")"`,
      {
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_TEST_MISSING: missing,
        RETIRE_TEST_REPLACED: replaced,
        RETIRE_TEST_VALID: valid,
        RETIRE_TEST_CAPTURE: capture,
      }
    );
    assert.equal(output, 'archive\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('keeps the image save deadline at the measured bounded 300 seconds', async () => {
  const sourcedValues = await runFixture(
    'printf \'%s\\n%s\\n\' "$RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS" "$RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS"'
  );
  assert.equal(sourcedValues, '300\n600\n');
  await assert.rejects(
    runFixture(
      'status="$2/status"; printf \'0\\n\' >"$status"; running_container_now() { printf \'300\\n\'; }; running_container_wait_group "$RUNNING_CONTAINER_IMAGE_SAVE_TIMEOUT_SECONDS" -- "$status"'
    ),
    (error) => error.code === 124
  );
});
test('allows stable large filesystem exports to exceed five minutes', async () => {
  const output = await runFixture(
    `status="$2/status"; printf '0\\n' >"$status"; running_container_now() { printf '301\\n'; }; running_container_wait_group "$RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS" -- "$status"; printf 'accepted\\n'`
  );
  assert.equal(output, 'accepted\n');
});
test('keeps the large filesystem export deadline bounded at ten minutes', async () => {
  await assert.rejects(
    runFixture(
      `status="$2/status"; printf '0\\n' >"$status"; running_container_now() { printf '600\\n'; }; running_container_wait_group "$RUNNING_CONTAINER_FILESYSTEM_SAVE_TIMEOUT_SECONDS" -- "$status"`
    ),
    (error) => error.code === 124
  );
});

test('rejects unknown archive command kinds without executing Docker', async () => {
  await assert.rejects(
    runFixture(
      'docker() { exit 91; }; running_container_archive_command unknown fixture'
    ),
    (error) => error.code === 2
  );
});

test('fails closed when an archive reader reports an I/O error after partial input', async () => {
  const source = await readFile(
    new URL('./retire-ollama-running-archive.sh', import.meta.url),
    'utf8'
  );
  assert.equal((source.match(/defined \$read/g) ?? []).length, 2);
  assert.equal((source.match(/close \$fh or \$ok = 0/g) ?? []).length, 1);
  assert.equal((source.match(/close STDOUT or \$ok = 0/g) ?? []).length, 1);
  assert.match(source, /running_container_archive_hash_tool/);
  assert.match(source, /\/usr\/bin\/shasum/);

  const simulateReader = async (loop) => {
    const program = `
package BrokenInput;
sub TIEHANDLE { bless { calls => 0 }, shift }
sub READ {
  my ($self, $buffer, $length, $offset) = @_;
  if ($self->{calls}++ == 0) {
    substr($$buffer, $offset // 0, $length, 'partial');
    return 7;
  }
  $! = 5;
  return undef;
}
package main;
tie *STDIN, 'BrokenInput';
my ($total, $ok) = (0, 1);
${loop}
exit($ok ? 0 : 2);
`;
    try {
      await execFileAsync('/usr/bin/perl', ['-e', program]);
      return 0;
    } catch (error) {
      return error.code;
    }
  };

  const oldBehavior = await simulateReader(
    'while (read(STDIN, my $chunk, 65536)) { $total += length($chunk); }'
  );
  const fixedBehavior = await simulateReader(
    'while (1) { my $read = read(STDIN, my $chunk, 65536); defined $read or $ok = 0, last; last unless $read; $total += $read; }'
  );
  assert.equal(oldBehavior, 0);
  assert.equal(fixedBehavior, 2);
});
