/**
 * Loyalty points deducted when a customer starts one prize exam attempt.
 *
 * Entry is FREE (0). Charging loyalty points made entry purchase-gated — points
 * are only ever earned by buying — which is consideration, and with prizes at
 * stake that turns the quiz into a regulated promotional competition with no
 * free-entry defence. `start_quiz_attempt` no longer charges; see
 * supabase/migrations/20260714102000_quiz_free_entry.sql.
 *
 * Kept rather than deleted: it is still the wire contract for the
 * `examPassPointsSpent` field returned to the web and mobile clients.
 */
export const EXAM_PASS_POINTS_COST = 0;

/**
 * Required by free-entry clients before the server creates an attempt.
 * Older bundles omit this marker and are rejected before the RPC runs, so they
 * cannot reject the new zero-cost response after consuming an attempt slot.
 */
export const QUIZ_FREE_ENTRY_MODE = 'free-v1' as const;

/** Signed RPC action used by the free-entry server route. */
export const QUIZ_FREE_ENTRY_RPC_ACTION = 'start_quiz_attempt_free_v1' as const;

/** Signed server action required before an attempt can be bound to a device. */
export const QUIZ_DEVICE_BIND_RPC_ACTION =
  'bind_quiz_attempt_device_v1' as const;

/** Signed server action for an atomic quiz start plus device-cap decision. */
export const QUIZ_DEVICE_START_RPC_ACTION =
  'start_quiz_attempt_with_device_v1' as const;

/** The version required by every new player-facing quiz event. */
export const QUIZ_CONTRACT_VERSION = 2 as const;

/** HTTP header used by web and mobile clients to declare quiz support. */
export const QUIZ_CONTRACT_HEADER = 'X-Baci-Quiz-Contract' as const;

/** Quiz modes supported by the versioned event contract. */
export const QUIZ_MODES = ['test', 'live'] as const;

/** Authoring bounds shared by the dashboard, APIs, and mobile clients. */
export const QUIZ_MIN_QUESTIONS_PER_TOPIC = 1;
export const QUIZ_MAX_QUESTIONS_PER_TOPIC = 20;
export const QUIZ_MAX_LOGICAL_QUESTIONS = 50;
export const QUIZ_MAX_TOPICS = 10;
export const QUIZ_MAX_TOPIC_LENGTH = 80;
export const QUIZ_MIN_TIME_PER_QUESTION_SECONDS = 5;
export const QUIZ_MAX_TIME_PER_QUESTION_SECONDS = 60;
export const QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS = 30;
export const QUIZ_DEFAULT_TIME_ZONE = 'Africa/Lagos';

/** Variant and attempt policy for the initial test and live releases. */
export const QUIZ_TEST_RULES_VERSION = 'test-v1';
export const QUIZ_LIVE_RULES_VERSION = 'live-v1';
export const QUIZ_TEST_DEFAULT_VARIANTS_PER_QUESTION = 1;
export const QUIZ_TEST_MIN_VARIANTS_PER_QUESTION = 1;
export const QUIZ_TEST_MAX_VARIANTS_PER_QUESTION = 3;
export const QUIZ_LIVE_VARIANTS_PER_QUESTION = 3;
export const QUIZ_TEST_DEFAULT_MAX_ATTEMPTS = 10;
export const QUIZ_TEST_MIN_MAX_ATTEMPTS = 1;
export const QUIZ_TEST_MAX_MAX_ATTEMPTS = 50;
export const QUIZ_LIVE_MAX_ATTEMPTS = 1;

/**
 * Contract names for persisted attempt lifecycle outcomes. These describe the
 * required database policy; TypeScript constants cannot enforce that policy.
 */
export const QUIZ_ATTEMPT_LIFECYCLE_STATUSES = [
  'started',
  'submitted',
  'scored',
  'disqualified',
  'expired',
  'test_reset',
  'tester_revoked',
  'event_cancelled',
] as const;

/** Auditable test resets do not consume a configured test-attempt cap. */
export const QUIZ_TEST_ATTEMPT_CAP_EXCLUDED_STATUSES = ['test_reset'] as const;

/** These terminal outcomes must never contribute to a ranking or an award. */
export const QUIZ_NON_RANKING_TERMINAL_ATTEMPT_STATUSES = [
  'disqualified',
  'expired',
  'test_reset',
  'tester_revoked',
  'event_cancelled',
] as const;

/** Universal-window policy. Live events include a bounded join grace period. */
export const QUIZ_LIVE_WINDOW_MINIMUM_GRACE_SECONDS = 30;
export const QUIZ_LIVE_WINDOW_SUGGESTED_GRACE_SECONDS = 90;
export const QUIZ_LIVE_WINDOW_MAXIMUM_GRACE_SECONDS = 120;
export const QUIZ_WINDOW_ROUNDING_SECONDS = 60;
/**
 * Test rehearsal windows stay unbounded by play time, but must remain a
 * representable end date when the activation resolver adds them to now.
 */
export const QUIZ_TEST_WINDOW_MAXIMUM_SECONDS = 24 * 60 * 60;

/** Bounded client/server reconciliation and durable-generation policy. */
export const QUIZ_ACTIVE_ATTEMPT_RECONCILIATION_CADENCE_SECONDS = 15;
export const QUIZ_GENERATION_MAX_NEW_JOBS_PER_MERCHANT_ROLLING_24_HOURS = 10;
export const QUIZ_GENERATION_MAX_ACTIVE_JOBS_PER_MERCHANT = 1;

export type QuizMode = (typeof QUIZ_MODES)[number];
export type QuizAttemptLifecycleStatus =
  (typeof QUIZ_ATTEMPT_LIFECYCLE_STATUSES)[number];

/**
 * The client-side launch payload policy. The launch route remains the
 * authority and will fail closed when a live rules version is not approved.
 */
export function getQuizLaunchPolicy(mode: QuizMode): Readonly<{
  maxAttempts: number;
  rulesVersion: string;
  timeZone: string;
  variantsPerQuestion: number;
}> {
  if (mode === 'live') {
    return {
      maxAttempts: QUIZ_LIVE_MAX_ATTEMPTS,
      rulesVersion: QUIZ_LIVE_RULES_VERSION,
      timeZone: QUIZ_DEFAULT_TIME_ZONE,
      variantsPerQuestion: QUIZ_LIVE_VARIANTS_PER_QUESTION,
    };
  }

  return {
    maxAttempts: QUIZ_TEST_DEFAULT_MAX_ATTEMPTS,
    rulesVersion: QUIZ_TEST_RULES_VERSION,
    timeZone: QUIZ_DEFAULT_TIME_ZONE,
    variantsPerQuestion: QUIZ_TEST_DEFAULT_VARIANTS_PER_QUESTION,
  };
}

/** Documents the database's test-cap exclusion rule for later runtime callers. */
export function isQuizAttemptExcludedFromTestCap(
  status: QuizAttemptLifecycleStatus
): boolean {
  return (
    QUIZ_TEST_ATTEMPT_CAP_EXCLUDED_STATUSES as readonly string[]
  ).includes(status);
}

/** Documents which terminal lifecycle outcomes are ineligible for ranking. */
export function isQuizAttemptNonRankingTerminal(
  status: QuizAttemptLifecycleStatus
): boolean {
  return (
    QUIZ_NON_RANKING_TERMINAL_ATTEMPT_STATUSES as readonly string[]
  ).includes(status);
}

/** Returns the contract attempt limit; the database remains the authority. */
export function getQuizMaxAttemptsForMode(
  mode: QuizMode,
  testMaxAttempts: number
): number {
  if (mode === 'live') return QUIZ_LIVE_MAX_ATTEMPTS;
  if (
    !Number.isInteger(testMaxAttempts) ||
    testMaxAttempts < QUIZ_TEST_MIN_MAX_ATTEMPTS ||
    testMaxAttempts > QUIZ_TEST_MAX_MAX_ATTEMPTS
  ) {
    throw new RangeError('Test quiz attempts are outside the allowed bounds');
  }
  return testMaxAttempts;
}

/** Returns the maximum time an uninterrupted attempt can consume. */
export function getQuizMaximumPlaySeconds(
  questionCount: number,
  timePerQuestionSeconds: number
): number {
  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    throw new RangeError('Quiz question count must be a positive integer');
  }
  if (
    !Number.isInteger(timePerQuestionSeconds) ||
    timePerQuestionSeconds <= 0
  ) {
    throw new RangeError('Quiz question time must be a positive integer');
  }
  return questionCount * timePerQuestionSeconds;
}

/** Suggests a whole-minute live window with the documented 90-second grace. */
export function getSuggestedQuizLiveWindowSeconds(
  questionCount: number,
  timePerQuestionSeconds: number
): number {
  const maximumPlaySeconds = getQuizMaximumPlaySeconds(
    questionCount,
    timePerQuestionSeconds
  );

  const roundedSuggestion =
    Math.ceil(
      (maximumPlaySeconds + QUIZ_LIVE_WINDOW_SUGGESTED_GRACE_SECONDS) /
        QUIZ_WINDOW_ROUNDING_SECONDS
    ) * QUIZ_WINDOW_ROUNDING_SECONDS;
  const { maximumSeconds } = getQuizWindowBounds(
    'live',
    questionCount,
    timePerQuestionSeconds
  );

  if (maximumSeconds === null || roundedSuggestion <= maximumSeconds) {
    return roundedSuggestion;
  }

  return (
    Math.floor(maximumSeconds / QUIZ_WINDOW_ROUNDING_SECONDS) *
    QUIZ_WINDOW_ROUNDING_SECONDS
  );
}

/**
 * Returns the allowable universal window for a mode. Test windows can be
 * shorter for QA, but cannot end before one configured question window.
 */
export function getQuizWindowBounds(
  mode: QuizMode,
  questionCount: number,
  timePerQuestionSeconds: number
): { maximumSeconds: number | null; minimumSeconds: number } {
  const maximumPlaySeconds = getQuizMaximumPlaySeconds(
    questionCount,
    timePerQuestionSeconds
  );

  if (mode === 'test') {
    return {
      maximumSeconds: QUIZ_TEST_WINDOW_MAXIMUM_SECONDS,
      minimumSeconds: timePerQuestionSeconds,
    };
  }

  return {
    maximumSeconds: maximumPlaySeconds + QUIZ_LIVE_WINDOW_MAXIMUM_GRACE_SECONDS,
    minimumSeconds: maximumPlaySeconds + QUIZ_LIVE_WINDOW_MINIMUM_GRACE_SECONDS,
  };
}

/** Tests whether a requested universal window is valid for the event mode. */
export function isQuizWindowSecondsAllowed(
  mode: QuizMode,
  questionCount: number,
  timePerQuestionSeconds: number,
  windowSeconds: number
): boolean {
  if (!Number.isInteger(windowSeconds)) return false;

  try {
    const bounds = getQuizWindowBounds(
      mode,
      questionCount,
      timePerQuestionSeconds
    );

    return (
      windowSeconds >= bounds.minimumSeconds &&
      (bounds.maximumSeconds === null || windowSeconds <= bounds.maximumSeconds)
    );
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
