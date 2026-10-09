import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';

export type SearchSubmissionRow = {
  merchant_id: string;
  search_query: string;
  results_count: number;
  search_method: 'client';
};

/**
 * Search-submissions ingestion boundary (#3581).
 *
 * Only the public `/api/search/submissions` route may call this, after the
 * Origin check and storefront resolution pass. This module is the only
 * importer of the `search-analytics` brand, and it exposes a single insert
 * with fully server-derived values — importers never receive the
 * RLS-bypassing client itself. Anon/authenticated table writes stay
 * revoked. Server-only: must never enter a client graph.
 *
 * PENDING owner-approved temporary exception (repo NEVER rule): remove this
 * edge when search ingestion moves to a restricted worker role, or obtain
 * explicit reapproval. No sibling route or generic service-role operation
 * inherits authorization.
 */
export async function recordSearchSubmission(
  row: SearchSubmissionRow
): Promise<{ error: PostgrestError | null }> {
  const client = createServiceClient('search-analytics');
  const { error } = await client.from('search_analytics').insert(row);
  return { error };
}
