import { after } from 'next/server';
import { scheduleOrderProductBlogPurge } from './schedule-order-product-blog-purge';

type ScheduleOrderProductBlogPurgeInput = Parameters<
  typeof scheduleOrderProductBlogPurge
>[0];

/**
 * Queue order-related article enrichment after the response has flushed.
 * Checkout and cancellation must not wait for paginated blog lookups; the
 * underlying helper remains best-effort and fail-open.
 */
export function scheduleOrderProductBlogPurgeAfterResponse(
  input: ScheduleOrderProductBlogPurgeInput
): void {
  try {
    after(() => scheduleOrderProductBlogPurge(input));
  } catch {
    // Standalone workers and tests may not have a request context. Detach the
    // same best-effort work there rather than making the mutation fail.
    void scheduleOrderProductBlogPurge(input);
  }
}
