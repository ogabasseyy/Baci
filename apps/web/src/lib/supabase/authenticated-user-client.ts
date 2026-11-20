import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { requestScopedFetch } from './request-scoped-fetch';
/** Server-only bearer client. It never reads cookies or owns refresh tokens. */
export async function createAuthenticatedUserClient(config: {
  url: string;
  anonKey: string;
  accessToken: string;
  actorUserId: string;
  authSignal?: AbortSignal;
}) {
  const { authSignal } = config;
  authSignal?.throwIfAborted();
  const authFetch = authSignal && requestScopedFetch(authSignal);
  const client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      ...(authFetch && {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          // Scope auth reads only. Tool writes keep their existing retry contract.
          const url = input instanceof Request ? input.url : input;
          return new URL(url).pathname === '/auth/v1/user'
            ? authFetch(input, init)
            : fetch(input, init);
        },
      }),
    },
  });
  const { data, error } = await client.auth.getUser();
  authSignal?.throwIfAborted();
  if (error || data.user?.id !== config.actorUserId)
    throw new Error('Reconnect Baci to continue.');
  return client;
}
