import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../tools/builder-auth/publication-test-support', () => ({
  publicationFixture: fixture.create,
}));

import { lifecycleFixture } from './sql.test-support';

it.each([
  'ddl',
  'connect',
] as const)('closes the disposable publication fixture after %s setup fails', async (phase) => {
  const original = Error('synthetic fixture setup failure');
  const close = vi.fn(async () => {});
  const pool = {
    query: vi.fn(async () => {
      if (phase === 'ddl') throw original;
    }),
    connect: vi.fn(async () => {
      throw original;
    }),
  };
  fixture.create.mockResolvedValue({ pool, close });
  await expect(lifecycleFixture()).rejects.toBe(original);
  expect(close).toHaveBeenCalledTimes(1);
});
