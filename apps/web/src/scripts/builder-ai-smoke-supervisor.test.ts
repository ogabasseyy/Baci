import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runBuilderAiSmokeWorkerCommand,
  type BuilderAiSmokeWorkerCommand,
} from './builder-ai-smoke-supervisor';

const hungWorkerPath = path.resolve(
  process.cwd(),
  'src/scripts/builder-ai-smoke-supervisor.test-fixture.ts'
);
const smokeWorkerPath = path.resolve(
  process.cwd(),
  'src/scripts/builder-ai-json-transport-worker.ts'
);

const observedPids: number[] = [];
const temporaryDirectories: string[] = [];

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`worker ${pid} survived its deadline`);
}

describe('builder AI smoke supervisor', () => {
  afterEach(async () => {
    await Promise.all(observedPids.splice(0).map(waitForExit));
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true })
      )
    );
  });

  it('kills a deliberately hung credential worker at its deadline', async () => {
    const command: BuilderAiSmokeWorkerCommand = {
      kind: 'list',
      sourcePath: '/test/source.env',
    };
    const result = await runBuilderAiSmokeWorkerCommand(command, {
      deadlineMs: 20,
      onChildStarted: (pid) => observedPids.push(pid),
      workerPath: hungWorkerPath,
    });

    expect(result).toEqual({ kind: 'timeout' });
    expect(observedPids).toHaveLength(1);
  });

  it('prevents a timed-out worker from completing deferred work', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'baci-ai-smoke-'));
    temporaryDirectories.push(directory);
    const markerPath = path.join(directory, 'survived.txt');

    await expect(
      runBuilderAiSmokeWorkerCommand(
        { kind: 'list', sourcePath: '/test/source.env' },
        {
          deadlineMs: 20,
          onChildStarted: (pid) => observedPids.push(pid),
          workerArgs: [markerPath],
          workerPath: hungWorkerPath,
        }
      )
    ).resolves.toEqual({ kind: 'timeout' });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(access(markerPath)).rejects.toThrow();
  });

  it('runs the production worker through IPC without accepting an unapproved source', async () => {
    await expect(
      runBuilderAiSmokeWorkerCommand(
        { kind: 'list', sourcePath: '/not-a-primary-checkout/.env' },
        { deadlineMs: 2_000, workerPath: smokeWorkerPath }
      )
    ).resolves.toEqual({ kind: 'error' });
  });

  it('returns only allowlisted worker records', async () => {
    const result = await runBuilderAiSmokeWorkerCommand(
      { kind: 'list', sourcePath: '/test/source.env' },
      {
        deadlineMs: 20,
        onChildStarted: (pid) => observedPids.push(pid),
        workerPath: hungWorkerPath,
      }
    );

    expect(JSON.stringify(result)).not.toMatch(/env|secret|credential|path/i);
  });
});
