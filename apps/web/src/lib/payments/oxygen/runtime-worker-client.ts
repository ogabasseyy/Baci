import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';

/** A connection owns one ordinary worker session; it is never shared across requests. */
export function createOxygenWorkerClient(email: string, password: string) {
  type Worker = ReturnType<typeof createClient>;
  let cached: { client: Worker; validUntil: number } | undefined;
  let pending: Promise<Worker> | undefined;
  return async (): Promise<Worker> => {
    if (cached && Date.now() < cached.validUntil) return cached.client;
    if (!pending) {
      pending = (async () => {
        try {
          const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          });
          const { data, error } = await client.auth.signInWithPassword({
            email,
            password,
          });
          const expiresAt = data?.session?.expires_at;
          const validUntil =
            typeof expiresAt === 'number' ? expiresAt * 1000 - 30_000 : 0;
          if (error || !Number.isFinite(validUntil) || validUntil <= Date.now())
            throw new Error('Workflow unavailable');
          cached = { client, validUntil };
          return client;
        } catch {
          cached = undefined;
          throw new Error('Workflow unavailable');
        }
      })();
    }
    const inFlight = pending;
    try {
      return await inFlight;
    } finally {
      if (pending === inFlight) pending = undefined;
    }
  };
}
