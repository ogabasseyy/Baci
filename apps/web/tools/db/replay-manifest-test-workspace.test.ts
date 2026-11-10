import { access, rm } from 'node:fs/promises';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';

it('keeps a workspace until its timed-out test operation finishes', async () => {
  const removeRoot = vi.fn((root: string) =>
    rm(root, { force: true, recursive: true })
  );
  const workspace = createReplayManifestTestWorkspace(removeRoot);
  onTestFinished(() => workspace.cleanUp(), 120_000);
  const root = await workspace.run(() => workspace.copyWorkspace());
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = workspace.run(async () => {
    await paused;
    await access(root);
  });
  const cleanup = workspace.cleanUp();
  let outcomes: PromiseSettledResult<unknown>[] = [];
  try {
    await nextEventLoopTurn();
    expect(removeRoot).not.toHaveBeenCalled();
    await expect(access(root)).resolves.toBeUndefined();
  } finally {
    release();
    outcomes = await Promise.allSettled([operation, cleanup]);
  }
  expect(outcomes.map((outcome) => outcome.status)).toEqual([
    'fulfilled',
    'fulfilled',
  ]);
  expect(removeRoot).toHaveBeenCalledWith(root);
  await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
}, 90_000);

it('retains a failed removal for a later cleanup retry', async () => {
  const removeRoot = vi
    .fn<(root: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('temporary removal failure'))
    .mockImplementation((root) => rm(root, { force: true, recursive: true }));
  const workspace = createReplayManifestTestWorkspace(removeRoot);
  onTestFinished(async () => {
    removeRoot.mockReset();
    removeRoot.mockImplementation((root) =>
      rm(root, { force: true, recursive: true })
    );
    await workspace.cleanUp();
  }, 120_000);
  const root = await workspace.run(() => workspace.copyWorkspace());
  try {
    await expect(workspace.cleanUp()).rejects.toThrow(
      'temporary removal failure'
    );
    await workspace.cleanUp();
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}, 90_000);
