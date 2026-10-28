import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createStorefrontPublicReadFetch } from '@/lib/storefront-public-read-fetch';

function getPublicSupabaseCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Public Supabase configuration is missing');
  }

  return { key, url };
}

export function createPublicClient(options: {
  clientInfo: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): SupabaseClient {
  const { key, url } = getPublicSupabaseCredentials();

  const signal = options.signal;
  const publicFetch = createStorefrontPublicReadFetch(options.timeoutMs);
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        'X-Client-Info': options.clientInfo,
      },
      fetch: signal
        ? (input, init = {}) => {
            if (signal.aborted) return Promise.reject(signal.reason);
            return publicFetch(input, {
              ...init,
              signal: init.signal
                ? AbortSignal.any([init.signal, signal])
                : signal,
            });
          }
        : publicFetch,
    },
  });
}
