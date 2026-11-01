import { QuizAppOnlyError } from '@/app/api/quiz/_shared/quiz-app-only-error';
import {
  enforceQuizAgeGate,
  type ServerSupabaseClient,
} from '@/app/api/quiz/_shared/route-helpers-guards';
import {
  getQuizPhaseEnv,
  getQuizProductionApprovedEnv,
} from '@/lib/quiz/quiz-runtime-env';
import { QuizProductionNotApprovedError } from '@/lib/quiz-compliance-gate';

/** Normal authenticated client only; private tests never require live prize approval. */
export async function enforceQuizStartGuards(
  supabase: ServerSupabaseClient,
  eventId: string,
  userId: string,
  // Required (no default) so a new caller cannot silently skip the app-only
  // browser restriction.
  authMethod: 'bearer' | 'cookie'
): Promise<void> {
  if (getQuizPhaseEnv() !== 'production') return;
  // Players cannot read quiz_events rows directly (RLS restricts v2 rows to
  // merchant users), so resolve mode/merchant through the safe projection RPC.
  // A direct table read would silently return no row and block every start.
  const { data, error } = await supabase.rpc(
    'get_quiz_start_guard_context_v2',
    { p_event_id: eventId }
  );
  if (
    error ||
    !data ||
    typeof data !== 'object' ||
    (data as { found?: unknown }).found !== true
  ) {
    throw new Error('Quiz start eligibility could not be verified');
  }
  const context = data as {
    merchant_id?: unknown;
    mode?: unknown;
    prize_approved?: unknown;
  };
  if (
    typeof context.merchant_id !== 'string' ||
    (context.mode !== 'test' && context.mode !== 'live')
  ) {
    throw new Error('Quiz start eligibility could not be verified');
  }
  // Live prizes are app-only: a browser session (cookie auth) only carries
  // the weaker web device identity, so it may not compete for a real prize.
  if (context.mode === 'live' && authMethod === 'cookie') {
    throw new QuizAppOnlyError();
  }
  // Live prizes need operations approval plus a positive compliance verdict
  // from the projection; the evidence itself is never player-readable.
  if (
    context.mode === 'live' &&
    (!getQuizProductionApprovedEnv() || context.prize_approved !== true)
  ) {
    throw new QuizProductionNotApprovedError();
  }
  await enforceQuizAgeGate(supabase, context.merchant_id, userId);
}
