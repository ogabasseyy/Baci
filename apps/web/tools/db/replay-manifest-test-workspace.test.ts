import { access, rm } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { createReplayManifestTestWorkspace } from './replay-manifest-test-workspace.test-support';

it('keeps a workspace until its timed-out test operation finishes', async () => {
  const removeRoot = vi.fn((root: string) =>
    rm(root, { force: true, recursive: true })
  );
  const workspace = createReplayManifestTestWorkspace(removeRoot);
  const root = await workspace.copyWorkspace();
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
    await Promise.resolve();
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
