import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { authenticateEditUser } from './edit-user';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
afterEach(() => vi.clearAllMocks());
it('uses only the supplied bearer without persisting a session', async () => {
  const client = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'actor' } }, error: null }),
    },
  };
  vi.mocked(createClient).mockReturnValue(
    client as unknown as ReturnType<typeof createClient>
  );
  await expect(
    authenticateEditUser('fixture-token', {
      url: 'https://fixture.supabase.co',
      anonKey: 'public-key',
    })
  ).resolves.toEqual({ actorUserId: 'actor', client });
  expect(createClient).toHaveBeenCalledWith(
    'https://fixture.supabase.co',
    'public-key',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: 'Bearer fixture-token' } },
    }
  );
});
it('rejects invalid upstream credentials without cookie fallback', async () => {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'private provider detail' },
      }),
    },
  };
  vi.mocked(createClient).mockReturnValue(
    client as unknown as ReturnType<typeof createClient>
  );
  await expect(
    authenticateEditUser('invalid', {
      url: 'https://fixture.supabase.co',
      anonKey: 'public-key',
    })
  ).rejects.toThrow('Unauthorized');
});
