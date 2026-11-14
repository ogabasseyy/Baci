import { expect, it, vi } from 'vitest';

vi.mock('./authorization', () => ({
  requireExperienceOwner: vi.fn(async (ctx) => ctx),
}));

import { readExperienceOperation } from './build-service';

it('returns the database-computed expired status for an unfinished job', async () => {
  const context = {
    merchantId: 'merchant',
    supabase: {
      rpc: vi.fn(async () => ({
        data: {
          id: 'job',
          status: 'expired',
          expires_at: '2000-01-01T00:00:00Z',
        },
        error: null,
      })),
    },
  };
  expect(await readExperienceOperation(context as never, 'job')).toMatchObject({
    id: 'job',
    status: 'expired',
  });
});

it('returns the retained build identity for a finalized owner job', async () => {
  const rows: Record<string, unknown> = {
    id: 'job',
    status: 'finalized',
    expires_at: '2099-01-01T00:00:00Z',
    buildId: '11111111-1111-4111-8111-111111111111',
    buildDigest: 'a'.repeat(64),
  };
  const context = {
    merchantId: 'merchant',
    supabase: {
      rpc: async () => ({ data: rows, error: null }),
    },
  };
  expect(await readExperienceOperation(context as never, 'job')).toMatchObject({
    id: 'job',
    status: 'finalized',
    buildId: '11111111-1111-4111-8111-111111111111',
    buildDigest: 'a'.repeat(64),
  });
  rows.buildId = null;
  await expect(
    readExperienceOperation(context as never, 'job')
  ).rejects.toThrow('BUILD_FAILED');
});
