import type { Database } from '@/types/supabase';

export const COUNT_KEYS = [
  'scheduledPromoted',
  'testClosed',
  'zeroPlayerClosed',
  'testZeroPlayerClosed',
  'liveZeroPlayerClosed',
  'liveTerminalized',
  'testPublicationFailed',
  'liveTerminalizationFailed',
  'scheduledPromotionFailed',
  'testDeadlineClockFailed',
  'liveDeadlineClockFailed',
  'deadlineClockFailed',
  'liveFinalizationFailed',
  'testPublicationRetryPending',
  'liveTerminalizationRetryPending',
  'liveAwardRetryPending',
  'liveAwaitingGate',
  'awarded',
  'noWinner',
  'expired',
  'released',
  'skippedLive',
  'failed',
] as const;

export type CountKey = (typeof COUNT_KEYS)[number];
export type Summary = Record<CountKey, number>;

export type FinalizationStep =
  | {
      name:
        | 'close_due_product_quiz_events'
        | 'expire_unclaimed_ranked_quiz_awards_v2'
        | 'finalize_due_quiz_events'
        | 'finalize_due_test_quiz_events_v2'
        | 'promote_due_scheduled_quiz_events_service_v2'
        | 'terminalize_due_live_quiz_events_v2';
    }
  | {
      args: Database['public']['Functions']['finalize_due_live_quiz_events_v2']['Args'];
      name: 'finalize_due_live_quiz_events_v2';
    }
  | {
      args: Database['public']['Functions']['process_due_quiz_deadlines_v2']['Args'];
      name: 'process_due_quiz_deadlines_v2';
    }
  | {
      args: Database['public']['Functions']['set_quiz_runtime_control_v2']['Args'];
      name: 'set_quiz_runtime_control_v2';
    };

export const MUTATION_COUNT_KEYS = [
  'scheduledPromoted',
  'testClosed',
  'zeroPlayerClosed',
  'testZeroPlayerClosed',
  'liveZeroPlayerClosed',
  'liveTerminalized',
  'awarded',
  'noWinner',
  'expired',
  'released',
] as const;

const COUNT_KEY_SET = new Set<string>(COUNT_KEYS);
const BENIGN_NON_COUNTER_KEYS = new Set<string>([
  'runtimeGateFresh',
  'runtimeGateMatches',
]);

const SCALAR_MUTATION_STEPS = new Set<FinalizationStep['name']>([
  'promote_due_scheduled_quiz_events_service_v2',
  'close_due_product_quiz_events',
  'finalize_due_quiz_events',
]);

export interface MutationTrackingState {
  hasUnknownMutationResult: boolean;
  scalarMutationCount: number;
}

export function emptySummary(): Summary {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as Summary;
}

function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function summaryValue(payload: object, key: CountKey) {
  const value = (payload as Record<string, unknown>)[key];
  return isNonNegativeSafeInt(value) ? value : 0;
}

export function runtimeGateRejected(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const result = payload as Record<string, unknown>;
  return (
    result.runtimeGateMatches === false || result.runtimeGateFresh === false
  );
}

function addPayload(
  summary: Summary,
  state: MutationTrackingState,
  payload: unknown
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    state.hasUnknownMutationResult = true;
    return;
  }
  const record = payload as Record<string, unknown>;
  let hasRecognizedCounter = false;

  for (const key of COUNT_KEYS) {
    if (!(key in record) || record[key] === undefined) continue;
    hasRecognizedCounter = true;
    const value = record[key];
    if (isNonNegativeSafeInt(value)) {
      summary[key] += value;
    } else {
      state.hasUnknownMutationResult = true;
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      value === undefined ||
      COUNT_KEY_SET.has(key) ||
      BENIGN_NON_COUNTER_KEYS.has(key)
    ) {
      continue;
    }
    state.hasUnknownMutationResult = true;
  }

  if (!hasRecognizedCounter) {
    state.hasUnknownMutationResult = true;
  }

  summary.failed +=
    summaryValue(payload, 'testPublicationFailed') +
    summaryValue(payload, 'liveTerminalizationFailed') +
    summaryValue(payload, 'scheduledPromotionFailed') +
    summaryValue(payload, 'deadlineClockFailed') +
    summaryValue(payload, 'liveFinalizationFailed') +
    summaryValue(payload, 'testPublicationRetryPending') +
    summaryValue(payload, 'liveTerminalizationRetryPending') +
    summaryValue(payload, 'liveAwardRetryPending');
}

export function addStepPayload(
  summary: Summary,
  state: MutationTrackingState,
  step: FinalizationStep,
  payload: unknown
) {
  if (SCALAR_MUTATION_STEPS.has(step.name)) {
    if (!isNonNegativeSafeInt(payload)) {
      state.hasUnknownMutationResult = true;
      return;
    }
    if (step.name === 'promote_due_scheduled_quiz_events_service_v2') {
      summary.scheduledPromoted += payload;
    } else {
      state.scalarMutationCount += payload;
    }
    return;
  }
  if (
    step.name === 'process_due_quiz_deadlines_v2' &&
    runtimeGateRejected(payload)
  ) {
    summary.failed += 1;
  }
  addPayload(summary, state, payload);
}

export function hasQuizMutations(
  summary: Summary,
  state: MutationTrackingState
): boolean {
  return (
    state.scalarMutationCount > 0 ||
    MUTATION_COUNT_KEYS.some((key) => summary[key] > 0)
  );
}
