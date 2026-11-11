import { expect, it, vi } from 'vitest';
import { admitExperienceEffect } from './experience-admission';

it.each([
  'epoch',
  'shopperPartition',
  'buildDigest',
  'generation',
] as const)('rechecks %s after async state read; no stale effect', async (field) => {
  const state = {
    epoch: 1,
    shopperPartition: 'p',
    buildDigest: 'b',
    generation: 1,
    instanceId: 'i',
    revision: '1',
    transition: false,
    active: true,
    mode: 'private-preview' as const,
  };
  let release!: (b: boolean) => void;
  const effect = vi.fn();
  const pending = admitExperienceEffect(
    { ...state },
    () => state,
    () => new Promise<boolean>((r) => (release = r)),
    effect
  );
  Object.assign(state, {
    [field]: typeof state[field] === 'number' ? 2 : 'changed',
  });
  release(true);
  expect(await pending).toBe(false);
  expect(effect).not.toHaveBeenCalled();
});
