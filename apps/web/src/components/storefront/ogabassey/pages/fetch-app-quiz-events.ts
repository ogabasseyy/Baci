import {
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
} from '@baci/shared/constants';
import { type QuizV2Event, quizV2EventsResponseSchema } from '@baci/shared/schemas';
import { apiGet } from '@/lib/api-client';

/**
 * Lists the current (contract v2) Super Quiz events for display only. These
 * quizzes are played in the Ogabassey app, so the website shows what is on and
 * where to play it; the legacy web start path refuses v2 events.
 */
export async function fetchAppQuizEvents(
  merchantSlug: string
): Promise<QuizV2Event[]> {
  const query = new URLSearchParams({ limit: '20', merchantSlug, offset: '0' });
  const parsed = quizV2EventsResponseSchema.safeParse(
    await apiGet<unknown>(`/api/quiz/events?${query}`, {
      headers: { [QUIZ_CONTRACT_HEADER]: String(QUIZ_CONTRACT_VERSION) },
    })
  );
  if (!parsed.success) throw new Error('Invalid quiz response');
  // Only quizzes a shopper can still join are worth sending to the app.
  return parsed.data.events.filter(
    (event) => event.status === 'active' || event.status === 'scheduled'
  );
}
