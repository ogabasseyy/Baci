import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { SEARCH_SUBMISSION_QUERY_MAX_LENGTH } from '@/lib/search-submission-query';
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
 * with bounded values — merchant from the snapshot lookup, count from the
 * search RPC, and the caller-supplied query only after sanitize/trim/cap —
 * importers never receive the RLS-bypassing client itself.
 * Anon/authenticated table writes stay revoked. Server-only: must never
 * enter a client graph.
 *
 * Owner-approved temporary exception (repo NEVER rule, AGENTS.md 2026-10-09;
 * expires 2027-01-07 or when a restricted worker role exists): remove this
 * edge then, or obtain explicit reapproval. No sibling route or generic
 * service-role operation inherits authorization.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIngestibleRow(row: SearchSubmissionRow): boolean {
  if (!row || typeof row !== 'object') return false;
  if (
    typeof row.merchant_id !== 'string' ||
    typeof row.search_query !== 'string'
  )
    return false;
  // Trimmed length: the route path can never produce a whitespace-only
  // query (sanitizeSearchQuery trims), so a direct caller must not either.
  // Count is capped at the int4 column maximum, not just safe-integer.
  const trimmedQuery = row.search_query.trim();
  return (
    UUID_PATTERN.test(row.merchant_id) &&
    trimmedQuery.length >= 1 &&
    row.search_query.length <= SEARCH_SUBMISSION_QUERY_MAX_LENGTH &&
    Number.isInteger(row.results_count) &&
    row.results_count >= 0 &&
    row.results_count <= 2147483647 &&
    row.search_method === 'client'
  );
}

export async function recordSearchSubmission(
  row: SearchSubmissionRow
): Promise<{ error: PostgrestError | null }> {
  // Defense in depth: the sole route caller passes bounded values,
  // but this privileged client must never write an arbitrary tenant row if
  // a future importer passes caller-supplied data. Reject before touching
  // the service-role client so misuse fails loudly instead of misattributing.
  if (!isIngestibleRow(row)) {
    throw new Error('Invalid search submission row');
  }
  // Allowlist the insert payload: validation above checks types/ranges but
  // a future importer could pass extra keys (clicked_product_id, created_at,
  // ...) that would otherwise flow verbatim through the RLS-bypassing
  // branded client into an arbitrary tenant row.
  const payload: SearchSubmissionRow = {
    merchant_id: row.merchant_id,
    search_query: row.search_query.trim(),
    results_count: row.results_count,
    search_method: row.search_method,
  };
  const client = createServiceClient('search-analytics');
  const { error } = await client.from('search_analytics').insert(payload);
  return { error };
}
