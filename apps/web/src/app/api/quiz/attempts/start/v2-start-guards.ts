import {
  enforceEventPrizeGuard,
  enforceQuizAgeGate,
  type ServerSupabaseClient,
} from '@/app/api/quiz/_shared/route-helpers-guards';
import { getQuizPhaseEnv } from '@/lib/quiz/quiz-runtime-env';

/** Normal authenticated client only; private tests never require live prize approval. */
export async function enforceQuizStartGuards(
  supabase: ServerSupabaseClient,
  eventId: string,
  userId: string
): Promise<void> {
  if (getQuizPhaseEnv() !== 'production') return;
  const { data, error } = await supabase
    .from('quiz_events')
    .select('merchant_id, mode')
    .eq('id', eventId)
    .maybeSingle();
  if (
    error ||
    !data ||
    typeof data !== 'object' ||
    !('merchant_id' in data) ||
    typeof data.merchant_id !== 'string' ||
    !('mode' in data) ||
    (data.mode !== 'test' && data.mode !== 'live')
  ) {
    throw new Error('Quiz start eligibility could not be verified');
  }
  if (data.mode === 'live') await enforceEventPrizeGuard(supabase, eventId);
  await enforceQuizAgeGate(supabase, data.merchant_id, userId);
}
