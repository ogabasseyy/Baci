import { QUIZ_FREE_ENTRY_MODE } from '@baci/shared/constants';
import {
  type QuizV2Event,
  quizV2EventsResponseSchema,
} from '@baci/shared/schemas';
import type { ServerSupabaseClient } from '@/app/api/quiz/_shared/route-helpers-guards';
import { logger } from '@/lib/logger';

const PAGE_SIZE = 50;
// list_quiz_events_v2 orders by start time (newest first) and paginates before
// any status filter, so later scheduled/completed events can push a live quiz
// off the first page. Pages are read here on the server (bounded) so the web
// client gets every joinable quiz in one request.
const MAX_PAGES = 20;

export type CurrentQuizEventsResult =
  | { events: QuizV2Event[]; ok: true; serverNow: string }
  | { error: unknown; ok: false };

/**
 * Active and scheduled live (prize) v2 events for the caller, across bounded
 * pages. Test-mode events are excluded: they are not prizes and browser
 * sessions may start them, so they must not be framed as app-only.
 */
export async function listCurrentQuizEventsV2(
  supabase: ServerSupabaseClient,
  merchantId: string
): Promise<CurrentQuizEventsResult> {
  const events: QuizV2Event[] = [];
  let serverNow = '';
  let offset: number | null = 0;
  for (let page = 0; page < MAX_PAGES && offset !== null; page += 1) {
    const { data, error } = await supabase.rpc('list_quiz_events_v2', {
      p_limit: PAGE_SIZE,
      p_merchant_id: merchantId,
      p_offset: offset,
    });
    if (error) return { error, ok: false };
    const parsed = quizV2EventsResponseSchema.safeParse(
      data && typeof data === 'object'
        ? {
            ...(data as Record<string, unknown>),
            entryMode: QUIZ_FREE_ENTRY_MODE,
          }
        : data
    );
    if (!parsed.success) return { error: parsed.error, ok: false };
    serverNow ||= parsed.data.serverNow;
    events.push(...parsed.data.events);
    const { pagination } = parsed.data;
    offset = pagination?.hasMore ? pagination.nextOffset : null;
  }
  if (offset !== null) {
    logger.warn({
      context: 'listCurrentQuizEventsV2',
      message: 'Current quiz listing hit the page cap; later events omitted',
      merchantId,
    });
  }
  return {
    events: events.filter(
      (event) =>
        event.mode === 'live' &&
        (event.status === 'active' || event.status === 'scheduled')
    ),
    ok: true,
    serverNow,
  };
}
