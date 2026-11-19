import { expect, it, vi } from 'vitest';
import { readBrilStashPage } from './read-page';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabase/anon', () => ({
  createAnonClient: () => ({ rpc }),
}));

it('fails closed when the database totals disagree with the returned page', async () => {
  const abortSignal = vi.fn().mockResolvedValue({
    data: {
      status: 'ok',
      products: [],
      totalCount: 7,
      totalPages: 1,
      generationId: '70000000-0000-4000-8000-000000000001',
      credentialId: '80000000-0000-4000-8000-000000000001',
      payloadDigest: 'a'.repeat(64),
    },
    error: null,
  });
  const bearer = 'X'.repeat(43);
  rpc.mockReturnValue({ abortSignal });
  await expect(
    readBrilStashPage(bearer, { page: 1, limit: 3, min_price: 0 })
  ).resolves.toEqual({ status: 'unavailable' });
  expect(rpc).toHaveBeenCalledWith('read_brilstash_page', {
    p_bearer: bearer,
    p_page: 1,
    p_limit: 3,
    p_min_price: 0,
  });
  expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
