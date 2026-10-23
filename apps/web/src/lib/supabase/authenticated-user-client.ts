import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
/** Server-only bearer client. It never reads cookies or owns refresh tokens. */
export async function createAuthenticatedUserClient(config: {
  url: string;
  anonKey: string;
  accessToken: string;
  actorUserId: string;
}) {
  const client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${config.accessToken}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || data.user?.id !== config.actorUserId)
    throw new Error('Reconnect Baci to continue.');
  return client;
}
