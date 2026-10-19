import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';

export function createScopedClient(token: string): SupabaseClient {
  const supabaseUrl = getSupabaseUrl();
  if (process.env.NODE_ENV === 'production') {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supabaseUrl);
    } catch {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL');
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL');
    }
  }

  return createSupabaseClient(supabaseUrl, getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}
