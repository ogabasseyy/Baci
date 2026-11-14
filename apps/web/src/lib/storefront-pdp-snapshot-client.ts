import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorefrontDatabase } from '@/types/storefront-database';
import { getPublicSupabaseClient } from './public-supabase-client';

/** Creates the anonymous public client typed for the bounded storefront PDP snapshot RPC. */
export function getStorefrontSnapshotSupabaseClient(): SupabaseClient<StorefrontDatabase> {
  // The runtime client is the same anonymous public client used by the rest of
  // cached-data. This narrow generated-schema cast makes only the snapshot RPC
  // boundary aware of migrations that are not live when types are generated.
  return getPublicSupabaseClient() as unknown as SupabaseClient<StorefrontDatabase>;
}
