import 'server-only';

import {
  createServiceClient,
  type SearchAnalyticsServiceClient,
} from '@/lib/supabase/service';

/**
 * Search-submissions ingestion boundary (#3581).
 *
 * Only the public `/api/search/submissions` route may call this, after the
 * Origin check and storefront resolution pass. The client is limited by its
 * sole caller to the single `search_analytics` insert with fully
 * server-derived values; anon/authenticated table writes stay revoked.
 * Server-only: must never enter a client graph.
 *
 * PENDING owner-approved temporary exception (repo NEVER rule): remove this
 * edge when search ingestion moves to a restricted worker role, or obtain
 * explicit reapproval. No sibling route or generic service-role operation
 * inherits authorization.
 */
export function createSearchAnalyticsServiceClient(): SearchAnalyticsServiceClient {
  return createServiceClient('search-analytics');
}
