import {
  QUIZ_CONTRACT_HEADER,
  QUIZ_CONTRACT_VERSION,
} from '@baci/shared/constants';
import {
  type QuizV2Event,
  quizV2EventsResponseSchema,
} from '@baci/shared/schemas';
import { apiGet } from '@/lib/api-client';

/**
 * Lists the joinable (active/scheduled) contract-v2 Super Quiz events for
 * display only. These quizzes are played in the Ogabassey app, so the website
 * shows what is on and where to play it. `current=1` makes the server page and
 * filter the listing, so this is a single request.
 */
export async function fetchAppQuizEvents(
  merchantSlug: string
): Promise<QuizV2Event[]> {
  const query = new URLSearchParams({ current: '1', merchantSlug });
  const parsed = quizV2EventsResponseSchema.safeParse(
    await apiGet<unknown>(`/api/quiz/events?${query}`, {
      headers: { [QUIZ_CONTRACT_HEADER]: String(QUIZ_CONTRACT_VERSION) },
    })
  );
  if (!parsed.success) throw new Error('Invalid quiz response');
  return parsed.data.events;
}
