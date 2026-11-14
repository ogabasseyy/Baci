// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const create = vi.hoisted(() => vi.fn(() => ({ synthetic: true })));
vi.mock('@supabase/supabase-js', () => ({ createClient: create }));

import { createOwnerPreviewUserClientResolver } from './owner-preview-user-client';

it('creates only a normal user-scoped client with the verified bearer supplied to the bridge', async () => {
  const resolve = createOwnerPreviewUserClientResolver({
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_synthetic',
  });
  await resolve('synthetic.user.token');
  expect(create).toHaveBeenCalledWith(
    'https://project.supabase.co',
    'sb_publishable_synthetic',
    expect.objectContaining({
      global: { headers: { Authorization: 'Bearer synthetic.user.token' } },
      auth: expect.objectContaining({
        persistSession: false,
        autoRefreshToken: false,
      }),
    })
  );
});
it('rejects secret keys, non-HTTPS endpoints and malformed tokens', async () => {
  expect(() =>
    createOwnerPreviewUserClientResolver({
      url: 'https://project.supabase.co',
      anonKey: 'sb_secret_forbidden',
    })
  ).toThrow();
  expect(() =>
    createOwnerPreviewUserClientResolver({
      url: 'http://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    })
  ).toThrow();
  const resolve = createOwnerPreviewUserClientResolver({
    url: 'https://project.supabase.co',
    anonKey: 'sb_publishable_synthetic',
  });
  await expect(resolve('bad token')).rejects.toThrow();
});
