import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayCommandRuntime } from './run-replay-command';
import type { ReplayCommand } from './supabase-history-replay-types';

const temporaryRoots: string[] = [];
const runNode = (run: ReplayCommand, script: string) =>
  run(process.execPath, ['-e', script]);

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'baci-replay-command-'));
  temporaryRoots.push(root);
  return root;
}

describe('createReplayCommand', () => {
  it('passes arguments literally with shell disabled and repository-root cwd', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root);
    const literal = 'value; echo should-not-run';
    const canonicalRoot = await realpath(root);
    const result = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write(process.cwd() + "\\n" + process.argv[1])',
      literal,
    ]);
    expect(result).toEqual({
      stderr: '',
      stdout: `${canonicalRoot}\n${literal}`,
    });
  });

  it('writes bounded stdin without exposing it in failures', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root, {
      limits: { stderrBytes: 32, stdinBytes: 8, stdoutBytes: 32 },
    });
    const secret = 'postgresql://user:password@localhost/db';
    await expect(
      runCommand(process.execPath, ['-e', 'process.stdin.resume()'], {
        input: secret,
      })
    ).rejects.toThrow(/^node failed: stdin-limit$/);
  });

  it('caps stdout and stderr incrementally with sanitized errors', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root, {
      limits: { stderrBytes: 8, stdinBytes: 32, stdoutBytes: 8 },
    });
    await expect(
      runNode(runCommand, "process.stdout.write('secret-output-overflow')")
    ).rejects.toThrow(/^node failed: stdout-limit$/);
    await expect(
      runNode(runCommand, "process.stderr.write('secret-error-overflow')")
    ).rejects.toThrow(/^node failed: stderr-limit$/);
  });

  it('does not include argv, cwd, output, or environment in exit errors', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root);
    const secret = 'postgresql://user:password@localhost/db';
    await expect(
      runCommand(
        process.execPath,
        [
          '-e',
          "process.stdout.write(process.argv[1]); process.stderr.write(process.env.REPLAY_SECRET ?? ''); process.exit(7)",
          secret,
        ],
        { env: { ...process.env, REPLAY_SECRET: secret } }
      )
    ).rejects.toThrow(/^node failed: non-zero-exit$/);
    const throwingRun = replayCommandRuntime.create(root, {
      spawnProcess: (() => {
        throw new Error(secret);
      }) as never,
    });
    await expect(throwingRun('unsafe command', [])).rejects.toThrow(
      /^command failed: spawn-error$/
    );
  });

  it('reports only the SQL line and SQLSTATE from a failed psql command', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'psql:/owned/replay/secret.sql:42: ERROR:  42501: permission denied\\nidentity@example.test postgresql://user:password@localhost/db\\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);

    await expect(runCommand(psql, [])).rejects.toThrow(
      /^psql failed: non-zero-exit \(line=42,sqlstate=42501\)$/
    );
  });

  it.each([
    ['failed to connect to postgres: connection refused', 'connection-refused'],
    ['failed to pull image from private registry', 'image-pull'],
    ['failed to create docker container', 'container-create'],
    ['bind: address already in use', 'port-conflict'],
    ['container is unhealthy', 'container-health'],
    [
      'client version is too old. Minimum supported API version is 1.44',
      'docker-api',
    ],
    ['no space left on device', 'disk-full'],
    ['ERROR: permission denied (SQLSTATE 42501)', 'postgres-42501'],
  ])('classifies Supabase failures without copying private output: %s', async (message, diagnostic) => {
    const root = await temporaryRoot();
    const supabase = path.join(root, 'supabase');
    await writeFile(
      supabase,
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(`${message}\nhttps://user:private-password@db.example token=private-value`)});process.exit(1);\n`,
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);
    await expect(runCommand(supabase, ['db', 'start'])).rejects.toMatchObject({
      message: `supabase failed: non-zero-exit (diagnostic=${diagnostic})`,
    });
  });

  it('reports bounded diagnostics from a versioned psql executable', async () => {
    const root = await temporaryRoot();
    const psql = path.join(root, 'psql-18.3');
    await writeFile(
      psql,
      "#!/bin/sh\nprintf 'psql-18.3:/owned/replay/secret.sql:17: ERROR:  23505: duplicate key\\nprivate detail\\n' >&2\nexit 1\n",
      { mode: 0o700 }
    );
    const runCommand = replayCommandRuntime.create(root);

    await expect(runCommand(psql, [])).rejects.toThrow(
      /^psql-18\.3 failed: non-zero-exit \(line=17,sqlstate=23505\)$/
    );
  });

  it('preserves psql diagnostics when stdin closes before stderr is drained', async () => {
    const root = await temporaryRoot();
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn(() => true),
    });
    const runCommand = replayCommandRuntime.create(root, {
      spawnProcess: vi.fn(() => child) as never,
    });
    const failure = runCommand('/usr/bin/psql', [], { input: 'select 1;' });

    child.stdin.emit('error', new Error('write EPIPE'));
    child.stderr.write(
      'psql:/owned/replay/secret.sql:42: ERROR:  42501: permission denied\n'
    );
    child.emit('close', 1);

    await expect(failure).rejects.toThrow(
      /^psql failed: non-zero-exit \(line=42,sqlstate=42501\)$/
    );
  });

  it('reports timeout after the child exits on SIGTERM', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root, {
      executionTimeoutMs: 50,
      terminationGraceMs: 1_000,
    });
    await expect(
      runNode(
        runCommand,
        "process.on('SIGTERM', () => process.exit(0)); setTimeout(() => process.exit(0), 250)"
      )
    ).rejects.toThrow(/^node failed: timeout$/);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root, {
      executionTimeoutMs: 50,
      terminationGraceMs: 50,
    });
    const startedAt = Date.now();
    await expect(
      runNode(
        runCommand,
        "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 1000)"
      )
    ).rejects.toThrow(/^node failed: timeout$/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('settles once and clears listeners when termination races with close', async () => {
    const root = await temporaryRoot();
    const signals: NodeJS.Signals[] = [];
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn((signal: NodeJS.Signals) => {
        signals.push(signal);
        child.emit('close', 0);
        return true;
      }),
    });
    const rejected = vi.fn();
    const runCommand = replayCommandRuntime.create(root, {
      executionTimeoutMs: 1,
      spawnProcess: vi.fn(() => child) as never,
      terminationGraceMs: 5,
    });
    await expect(
      runNode(runCommand, 'setTimeout(() => process.exit(0), 100)').catch(
        (error: unknown) => {
          rejected(error);
          throw error;
        }
      )
    ).rejects.toThrow(/^node failed: timeout$/);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(signals).toEqual(['SIGTERM']);
    expect(rejected).toHaveBeenCalledOnce();
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
    expect(child.stdin.listenerCount('error')).toBe(0);
  });

  it('escalates output overflow to SIGKILL after the grace period', async () => {
    const root = await temporaryRoot();
    const runCommand = replayCommandRuntime.create(root, {
      executionTimeoutMs: 2_000,
      limits: { stderrBytes: 8, stdinBytes: 32, stdoutBytes: 8 },
      terminationGraceMs: 50,
    });
    const startedAt = Date.now();
    await expect(
      runNode(
        runCommand,
        "process.on('SIGTERM', () => {}); process.stdout.write('secret-output-overflow'); setTimeout(() => process.exit(0), 1000)"
      )
    ).rejects.toThrow(/^node failed: stdout-limit$/);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
