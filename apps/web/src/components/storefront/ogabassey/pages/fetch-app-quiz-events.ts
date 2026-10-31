import {
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
} from '@baci/shared/constants';
import {
  type QuizV2Event,
  quizV2EventsResponseSchema,
} from '@baci/shared/schemas';
import { apiGet } from '@/lib/api-client';

const PAGE_SIZE = 50;
// The listing is ordered by start time, newest first, and paginated before any
// status filter, so later scheduled/completed events can push a live quiz off
// the first page. Read a bounded number of pages before filtering.
const MAX_PAGES = 10;

async function fetchPage(merchantSlug: string, offset: number) {
  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    merchantSlug,
    offset: String(offset),
  });
  const parsed = quizV2EventsResponseSchema.safeParse(
    await apiGet<unknown>(`/api/quiz/events?${query}`, {
      headers: { [QUIZ_CONTRACT_HEADER]: String(QUIZ_CONTRACT_VERSION) },
    })
  );
  if (!parsed.success) throw new Error('Invalid quiz response');
  return parsed.data;
}

/**
 * Lists the current (contract v2) Super Quiz events for display only. These
 * quizzes are played in the Ogabassey app, so the website shows what is on and
 * where to play it; the legacy web start path refuses v2 events.
 */
export async function fetchAppQuizEvents(
  merchantSlug: string
): Promise<QuizV2Event[]> {
  const first = await fetchPage(merchantSlug, 0);
  const events = [...first.events];
  const nextOffset = first.pagination?.hasMore
    ? first.pagination.nextOffset
    : null;
  if (nextOffset !== null) {
    // Remaining pages are fetched in parallel (one extra round trip, not a
    // sequential waterfall), then concatenated up to the first final page.
    const rest = await Promise.all(
      Array.from({ length: MAX_PAGES - 1 }, (_, index) =>
        fetchPage(merchantSlug, nextOffset + index * PAGE_SIZE)
      )
    );
    for (const page of rest) {
      events.push(...page.events);
      if (!page.pagination?.hasMore) break;
    }
  }
  // Only quizzes a shopper can still join are worth sending to the app.
  return events.filter(
    (event) => event.status === 'active' || event.status === 'scheduled'
  );
}
