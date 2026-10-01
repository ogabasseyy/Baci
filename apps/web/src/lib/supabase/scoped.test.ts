import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSupabaseClient } = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(() => ({}) as never),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createSupabaseClient,
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: () => 'anon-key',
  getSupabaseUrl: () => process.env.NEXT_PUBLIC_SUPABASE_URL,
}));

import { createScopedClient } from '@/lib/supabase/scoped';

describe('createScopedClient', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    createSupabaseClient.mockClear();
  });

  it('accepts an HTTPS Supabase URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    createScopedClient('signed-token');

    expect(createSupabaseClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: { headers: { Authorization: 'Bearer signed-token' } },
      })
    );
  });

  it('rejects a non-HTTPS Supabase URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://project.supabase.co');

    expect(() => createScopedClient('signed-token')).toThrow(
      'NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL'
    );
    expect(createSupabaseClient).not.toHaveBeenCalled();
  });

  it('preserves HTTP URLs for non-production local development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');

    expect(() => createScopedClient('signed-token')).not.toThrow();
    expect(createSupabaseClient).toHaveBeenCalled();
  });
});
