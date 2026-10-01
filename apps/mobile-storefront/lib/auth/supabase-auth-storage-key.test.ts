import { getDefaultSupabaseAuthStorageKey } from './supabase-auth-storage-key';

describe('getDefaultSupabaseAuthStorageKey', () => {
  it.each([
    ['https://abc123.supabase.co', 'sb-abc123-auth-token'],
    ['https://abc123.supabase.co/', 'sb-abc123-auth-token'],
    ['https://abc123.supabase.co/auth/v1', 'sb-abc123-auth-token'],
    ['https://abc123.supabase.co:443', 'sb-abc123-auth-token'],
    [
      'https://abc123.supabase.co/auth/v1?redirect_to=ogabassey://auth',
      'sb-abc123-auth-token',
    ],
  ])('derives the Supabase default auth key from %s', (url, expected) => {
    expect(getDefaultSupabaseAuthStorageKey(url)).toBe(expected);
  });

  it('throws a controlled error for invalid Supabase URLs', () => {
    expect(() => getDefaultSupabaseAuthStorageKey('not-a-url')).toThrow(
      '[Supabase] Invalid Supabase URL; cannot derive default auth storage key.'
    );
  });
});
