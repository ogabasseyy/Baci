import { expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../tools/builder-auth/publication-test-support', () => ({
  publicationFixture: mocked.create,
}));

import {
  closeAuthoringFixture,
  experienceDataFixture,
} from './data-fixture.test-support';

it('closes the local database even if the API cleanup fails', async () => {
  const error = Error('synthetic API cleanup');
  const close = vi.fn(async () => {});
  await expect(
    closeAuthoringFixture(
      {
        close: async () => {
          throw error;
        },
      },
      { close }
    )
  ).rejects.toBe(error);
  expect(close).toHaveBeenCalledTimes(1);
});
it('rejects a non-disposable fixture before database mutations', async () => {
  const query = vi.fn(async () => ({}));
  const close = vi.fn(async () => {});
  mocked.create.mockResolvedValue({ pool: { query }, close });
  await expect(experienceDataFixture()).rejects.toThrow(
    'Disposable local PostgreSQL required'
  );
  expect(query).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});
