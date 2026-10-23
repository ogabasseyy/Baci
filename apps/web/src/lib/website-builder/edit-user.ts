import { createClient } from '@supabase/supabase-js';
import { getSupabaseAuthRuntimeConfig } from '@/lib/supabase/supabase-auth-runtime-config';
/** Dedicated upstream bearer only. Missing or invalid credentials never fall back to cookies. */
export async function authenticateEditUser(
  token: string,
  config = getSupabaseAuthRuntimeConfig()
) {
  const client = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Unauthorized');
  return { actorUserId: data.user.id, client };
}
