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
// the first page. Follow pages (bounded) before filtering.
const MAX_PAGES = 10;

/**
 * Lists the current (contract v2) Super Quiz events for display only. These
 * quizzes are played in the Ogabassey app, so the website shows what is on and
 * where to play it; the legacy web start path refuses v2 events.
 */
export async function fetchAppQuizEvents(
  merchantSlug: string
): Promise<QuizV2Event[]> {
  const events: QuizV2Event[] = [];
  let offset: number | null = 0;
  for (let page = 0; page < MAX_PAGES && offset !== null; page += 1) {
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
    events.push(...parsed.data.events);
    const { pagination } = parsed.data;
    offset = pagination?.hasMore ? pagination.nextOffset : null;
  }
  // Only quizzes a shopper can still join are worth sending to the app.
  return events.filter(
    (event) => event.status === 'active' || event.status === 'scheduled'
  );
}
