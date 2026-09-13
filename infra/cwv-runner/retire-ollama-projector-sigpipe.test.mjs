import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const helper = new URL('./retire-ollama-projector-auth.sh', import.meta.url);

async function waitForGrandchildTermination(pid) {
  const deadline = Date.now() + 2_000;
  let state = '';
  while (Date.now() < deadline) {
    try {
      const result = await execFileAsync('/bin/ps', [
        '-o',
        'state=',
        '-p',
        String(pid),
      ]);
      state = result.stdout.trim().charAt(0);
      // A zombie has already terminated; it only remains until its parent is
      // reaped. Treating it as live makes this regression test flaky.
      if (!state || state === 'Z') return;
    } catch (error) {
      if (error?.code === 1) return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`grandchild remained live (state ${state || 'unknown'})`);
}

async function waitForPidFile(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const value = (await readFile(path, 'utf8')).trim();
      if (/^[0-9]+$/.test(value)) return value;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('child PID file remained empty or absent');
}

test('terminates the projector process group after a broken pipe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-projector-sigpipe-'));
  const projector = join(directory, 'projector.pl');
  const archive = join(directory, 'image.tar');
  const scratch = join(directory, 'scratch');
  const childPidFile = join(directory, 'child.pid');
  let childPid = null;
  let terminationConfirmed = false;
  try {
    const prefix = `BEGIN {
  my $pid = fork();
  exit 2 unless defined $pid;
  if ($pid == 0) {
    close STDIN;
    open my $fh, '>', '${childPidFile}';
    print {$fh} "$$\\n";
    close $fh;
    sleep 30;
    exit 0;
  }
  while (!-e '${childPidFile}') { select undef, undef, undef, 0.01; }
  exit 2;
}
`;
    const bytes = Buffer.alloc(2_097_152, 35);
    Buffer.from(prefix).copy(bytes);
    await writeFile(projector, bytes, { mode: 0o644 });
    await writeFile(archive, 'archive', { mode: 0o600 });
    await writeFile(scratch, '', { mode: 0o600 });
    const expected = createHash('sha256').update(bytes).digest('hex');
    const command =
      '. "$1"; running_container_projector_execute "$2" "$3" "$4" "$5" "$6"';
    await assert.rejects(
      execFileAsync('sh', [
        '-c',
        command,
        'sh',
        helper.pathname,
        '1',
        projector,
        archive,
        scratch,
        expected,
      ]),
      (error) => error.code === 125
    );
    childPid = Number.parseInt(await waitForPidFile(childPidFile), 10);
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    await waitForGrandchildTermination(childPid);
    terminationConfirmed = true;
  } finally {
    if (childPid !== null && !terminationConfirmed) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // The child may have exited between the liveness check and the kill.
      }
    }
    await rm(directory, { force: true, recursive: true });
  }
});
