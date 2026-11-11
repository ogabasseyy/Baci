import { expect, it, vi } from 'vitest';
import { createExperienceRepository } from './repository';

it('fails closed on tenant storage errors and uses bounded explicit projections', async () => {
  const limit = vi.fn(async () => ({
    data: null,
    error: { message: 'secret' },
  }));
  const eq = vi.fn(() => ({ eq, limit }));
  const select = vi.fn(() => ({ eq, limit }));
  const repo = createExperienceRepository({
    merchantId: 'a',
    supabase: { from: () => ({ select }) },
  } as never);
  await expect(repo.readOwnedSource('id')).rejects.toThrow('NOT_FOUND');
  expect(select).toHaveBeenCalledWith('path,content');
  expect(eq).toHaveBeenCalledWith('merchant_id', 'a');
  expect(limit).toHaveBeenCalledWith(128);
});
