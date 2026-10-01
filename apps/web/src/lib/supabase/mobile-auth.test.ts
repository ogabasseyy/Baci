import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  createSupabaseClient: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createSupabaseClient,
}));
vi.mock('./supabase-auth-runtime-config', () => ({
  getSupabaseAuthRuntimeConfig: mocks.getRuntimeConfig,
}));

import { getAuthenticatedUser } from './mobile-auth';

function authClient(user: { id: string } | null, error: Error | null = null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  };
}

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeConfig.mockReturnValue({
      anonKey: 'anon-key',
      url: 'https://db.test',
    });
    mocks.cookies.mockResolvedValue({ get: vi.fn() });
  });

  it('tags a valid Authorization bearer session as bearer authentication', async () => {
    const supabase = authClient({ id: 'bearer-user' });
    mocks.createSupabaseClient.mockReturnValue(supabase);

    await expect(
      getAuthenticatedUser(
        new Request('https://baci.test', {
          headers: { Authorization: 'Bearer token' },
        })
      )
    ).resolves.toMatchObject({
      authMode: 'bearer',
      supabase,
      user: { id: 'bearer-user' },
    });
  });

  it('tags a valid cookie session as cookie authentication', async () => {
    const supabase = authClient({ id: 'cookie-user' });
    mocks.createServerClient.mockReturnValue(supabase);

    await expect(
      getAuthenticatedUser(new Request('https://baci.test'))
    ).resolves.toMatchObject({
      authMode: 'cookie',
      supabase,
      user: { id: 'cookie-user' },
    });
  });

  it('falls back to a valid cookie session after an invalid bearer token', async () => {
    mocks.createSupabaseClient.mockReturnValue(
      authClient(null, new Error('invalid token'))
    );
    const cookieSupabase = authClient({ id: 'cookie-user' });
    mocks.createServerClient.mockReturnValue(cookieSupabase);

    await expect(
      getAuthenticatedUser(
        new Request('https://baci.test', {
          headers: { Authorization: 'Bearer invalid' },
        })
      )
    ).resolves.toMatchObject({ authMode: 'cookie', supabase: cookieSupabase });
  });

  it.each([
    [
      'invalid bearer and invalid cookie',
      () => {
        mocks.createSupabaseClient.mockReturnValue(
          authClient(null, new Error('invalid token'))
        );
        mocks.createServerClient.mockReturnValue(
          authClient(null, new Error('no cookie session'))
        );
        return new Request('https://baci.test', {
          headers: { Authorization: 'Bearer invalid' },
        });
      },
    ],
    [
      'unavailable cookie store',
      () => {
        mocks.cookies.mockRejectedValue(new Error('cookies unavailable'));
        return new Request('https://baci.test');
      },
    ],
  ])('returns null for %s', async (_description, createRequest) => {
    await expect(getAuthenticatedUser(createRequest())).resolves.toBeNull();
  });
});
