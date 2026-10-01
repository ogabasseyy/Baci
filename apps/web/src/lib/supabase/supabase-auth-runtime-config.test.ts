import { describe, expect, it } from 'vitest';
import { getSupabaseAuthRuntimeConfig } from './supabase-auth-runtime-config';

describe('getSupabaseAuthRuntimeConfig', () => {
  it('reads only the public Supabase credentials and rejects incomplete configuration', () => {
    expect(
      getSupabaseAuthRuntimeConfig({
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      })
    ).toEqual({ anonKey: 'anon-key', url: 'https://project.supabase.co' });

    expect(() => getSupabaseAuthRuntimeConfig({})).toThrow(
      'Supabase configuration is missing'
    );
  });
});
