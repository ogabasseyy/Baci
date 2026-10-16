import { afterEach, expect, it, vi } from 'vitest';
import { generateEmbedding } from './embeddings';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'synthetic-test-token' } },
      }),
    },
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  '%s',
  '%o',
  '%c',
])('keeps %s in embedding identifiers out of the log format', async (id) => {
  const failure = new Error('synthetic unavailable');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(
    generateEmbedding({
      type: 'product',
      id,
      text: 'A sufficiently long product description',
    })
  ).resolves.toBe(false);
  expect(logged).toHaveBeenCalledWith('Error generating embedding:', {
    type: 'product',
    id,
    error: failure,
  });
});
it('retains successful embedding submission', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(
    generateEmbedding({
      type: 'blog',
      id: 'post-1',
      text: 'A sufficiently long blog description',
    })
  ).resolves.toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
});
