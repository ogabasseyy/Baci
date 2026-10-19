import { after } from 'next/server';
import {
  type ScheduleProductBlogPurgeInput,
  scheduleProductBlogPurge,
} from './schedule-product-blog-purge';

/**
 * Queue product-mutation article enrichment after the response has flushed.
 * Product writes must not wait for paginated relationship/category lookups;
 * the underlying helper is best-effort and fail-open.
 */
export function scheduleProductBlogPurgeAfterResponse(
  input: ScheduleProductBlogPurgeInput
): void {
  try {
    after(() => scheduleProductBlogPurge(input));
  } catch {
    // Standalone workers and tests may not have a request context. Detach the
    // same best-effort work there rather than making the mutation fail.
    void scheduleProductBlogPurge(input);
  }
}
