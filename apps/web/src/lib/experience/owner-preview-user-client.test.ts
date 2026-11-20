// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const create = vi.hoisted(() =>
  vi.fn((_url: string, _key: string, _options: unknown) => ({
    synthetic: true,
  }))
);
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

it('preserves a per-query signal while also enforcing the owner request deadline', async () => {
  const owner = new AbortController();
  const query = new AbortController();
  const upstream = vi.fn<typeof fetch>(async () => Response.json({}));
  vi.stubGlobal('fetch', upstream);
  try {
    const resolve = createOwnerPreviewUserClientResolver({
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    });
    await resolve('synthetic.user.token', owner.signal);
    const options = create.mock.calls.at(-1)?.[2] as unknown as {
      global: { fetch: typeof fetch };
    };
    await options.global.fetch('https://project.supabase.co/rest/v1/test', {
      signal: query.signal,
    });
    const combined = upstream.mock.calls[0][1]?.signal;
    expect(combined?.aborted).toBe(false);
    query.abort();
    expect(combined?.aborted).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
