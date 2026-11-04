import { expect, it, vi } from 'vitest';
import { loadNegotiationSupabaseClient } from './negotiation-supabase-client';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ marker: 'client' })),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: mocks.createClient }));
it('constructs the client only when the deferred loader is called', async () => {
  expect(mocks.createClient).not.toHaveBeenCalled();
  await expect(loadNegotiationSupabaseClient()).resolves.toEqual({
    marker: 'client',
  });
  expect(mocks.createClient).toHaveBeenCalledTimes(1);
});
