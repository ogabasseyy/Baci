import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./performance-read', () => ({ readExperiencePerformance: f.read }));
vi.mock('./owner-runtime', () => ({
  getExperienceOwnerRuntime: () => undefined,
}));

import { requirePublicationPerformance } from './publication-performance';

it('requires exact-build qualification before authorizing publication', async () => {
  const ctx = {} as never;
  const reader = vi.fn();
  f.read.mockResolvedValueOnce({ qualification: { status: 'passed' } });
  await expect(
    requirePublicationPerformance(ctx, 'build', reader)
  ).resolves.toBeUndefined();
  expect(f.read).toHaveBeenLastCalledWith(
    ctx,
    'build',
    reader,
    'storefront.publish'
  );
  for (const qualification of [
    { status: 'not-measured' },
    { status: 'failed', reason: 'missing-metrics' },
  ]) {
    f.read.mockResolvedValueOnce({ qualification });
    await expect(
      requirePublicationPerformance(ctx, 'build', reader)
    ).rejects.toThrow();
  }
});
