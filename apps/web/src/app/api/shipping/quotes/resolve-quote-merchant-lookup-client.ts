import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';

type HeaderReader = {
  headers: {
    get(name: string): string | null;
  };
};

/**
 * Resolves the Supabase client for trusted storefront merchant sender lookups.
 * Bearer tokens are installed only after validation; invalid tokens fall back
 * to the cookie/anonymous client so published-store RLS still applies.
 */
export async function resolveQuoteMerchantLookupClient(
  request: HeaderReader,
  supabase: SupabaseClient
): Promise<SupabaseClient> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  if (token) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (!error && user) {
      return createScopedClient(token);
    }
  }

  return await createServerSupabaseClient();
}
