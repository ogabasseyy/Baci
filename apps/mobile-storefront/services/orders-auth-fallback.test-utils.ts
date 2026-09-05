import type { Session } from '@supabase/supabase-js';

export function sessionFixture(
  accessToken: string,
  refreshToken: string,
  userId = 'user-a'
): Session {
  return {
    access_token: accessToken,
    expires_at: 1_800_000_000,
    expires_in: 3_600,
    refresh_token: refreshToken,
    token_type: 'bearer',
    user: {
      app_metadata: {},
      aud: 'authenticated',
      created_at: '2026-08-30T00:00:00Z',
      id: userId,
      role: 'authenticated',
      updated_at: '2026-08-30T00:00:00Z',
      user_metadata: {},
    },
  };
}
