import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('./retire-ollama.sh', import.meta.url);

test('clears a stale archive worker identity when group startup fails', () => {
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; RUNNING_CONTAINER_ARCHIVE_WORKER=group:99999; if running_container_archive_group_start invalid id output; then exit 1; else status=$?; fi; [ "$status" -eq 2 ] && [ -z "$RUNNING_CONTAINER_ARCHIVE_WORKER" ]`;
  const result = spawnSync('sh', [
    '-c',
    command,
    'archive-reset-test',
    script.pathname,
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
});

test('preserves caller signal traps while loading archive helpers', () => {
  const command = `trap 'exit 71' TERM; before=$(trap); . "$1"; SCRIPT_DIR=$(dirname "$1"); load_consumer_scanners; loaded=$(trap); running_container_archive_save_bounded invalid id output fifo status 1 || [ "$?" -eq 2 ]; after=$(trap); [ "$before" = "$loaded" ] && [ "$before" = "$after" ]`;
  const result = spawnSync('sh', [
    '-c',
    command,
    'archive-trap-scope-test',
    script.pathname,
  ]);
  assert.equal(result.status, 0, result.stderr?.toString());
});

test('binds the detached startup worker lifetime to its parent', async () => {
  const source = await readFile(
    new URL('./retire-ollama-running-archive.sh', import.meta.url),
    'utf8'
  );
  assert.match(source, /my \(\$parent, \$output, @command\) = @ARGV/);
  assert.match(source, /getppid != \$parent/);
  assert.match(source, /kill "TERM", -\$\$/);
});

test('terminates and reaps an archive worker when the scan receives TERM', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-archive-signal-')
  );
  const bin = join(directory, 'bin');
  const childPid = join(directory, 'child.pid');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'docker'),
    '#!/bin/sh\n/bin/sleep 30 & child=$!; printf "%s\\n" "$child" >"$RETIRE_TEST_CHILD_PID"; wait "$child"\n',
    { mode: 0o700 }
  );
  await chmod(join(bin, 'docker'), 0o700);
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; trap cleanup_temp EXIT; CANONICAL_DOCKER_SOCKET=/run/docker.sock; load_consumer_scanners; output=$(temp_path); fifo=$(temp_path); status=$(temp_path); running_container_archive_save_bounded image "${'a'.repeat(64)}" "$output" "$fifo" "$status" "$(( $(date +%s) + 60 ))"`;
  const child = spawn(
    'sh',
    ['-c', command, 'archive-signal-test', script.pathname, directory],
    {
      env: {
        ...process.env,
        RETIRE_OLLAMA_TEST_BIN: bin,
        RETIRE_OLLAMA_TEST_FSTYPE: 'apfs',
        RETIRE_TEST_CHILD_PID: childPid,
      },
    }
  );
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal }))
  );
  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        await readFile(childPid, 'utf8');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    child.kill('SIGTERM');
    const status = await exited;
    assert.equal(status.signal, null);
    assert.equal(status.code, 143);
    const pid = Number.parseInt(await readFile(childPid, 'utf8'), 10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});

test('supervisor terminates an archive worker when the scan parent disappears', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-parent-loss-'));
  const bin = join(directory, 'bin');
  const childPid = join(directory, 'child.pid');
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$$" >"$RETIRE_TEST_CHILD_PID"\nexec /bin/sleep 30\n',
    { mode: 0o700 }
  );
  await chmod(join(bin, 'docker'), 0o700);
  const command = `. "$1"; SCRIPT_DIR=$(dirname "$1"); RETIRE_OLLAMA_TMPDIR="$2"; load_temp_root_helper; temp_root_required_bytes() { printf '1\\n'; }; init_temp_root; CANONICAL_DOCKER_SOCKET=/run/docker.sock; load_consumer_scanners; output=$(temp_path); fifo=$(temp_path); status=$(temp_path); running_container_archive_save_bounded image "${'a'.repeat(64)}" "$output" "$fifo" "$status" "$(( $(date +%s) + 60 ))"`;
  const child = spawn(
    'sh',
    ['-c', command, 'archive-parent-loss-test', script.pathname, directory],
    { env: { ...process.env, RETIRE_OLLAMA_TEST_BIN: bin, RETIRE_OLLAMA_TEST_FSTYPE: 'apfs', RETIRE_TEST_CHILD_PID: childPid } }
  );
  try {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try { await readFile(childPid, 'utf8'); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
    }
    const pid = Number.parseInt(await readFile(childPid, 'utf8'), 10);
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try { process.kill(pid, 0); } catch { return; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    if (!child.killed) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});
