import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/** Creates no privileged client; the bridge separately verifies this user via getUser and RLS. */
export function createOwnerPreviewUserClientResolver(config: {
  url: string;
  anonKey: string;
}) {
  const url = new URL(config.url);
  if (
    url.protocol !== 'https:' ||
    url.origin !== config.url ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(config.anonKey)
  )
    throw Error('INVALID_OWNER_PREVIEW_USER_CLIENT');
  return (accessToken: string) => {
    if (
      !accessToken ||
      accessToken.length > 8192 ||
      !/^[A-Za-z0-9_.-]+$/.test(accessToken)
    )
      return Promise.reject(Error('INVALID_OWNER_PREVIEW_USER_CLIENT'));
    return Promise.resolve(
      createClient<Database>(config.url, config.anonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      })
    );
  };
}
