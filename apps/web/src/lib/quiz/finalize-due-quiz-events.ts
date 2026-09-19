import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  getQuizPhaseEnv,
  getQuizProductionApprovedEnv,
} from '@/lib/quiz/quiz-runtime-env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/supabase';
import { invalidateQuizProductCaches } from './quiz-product-cache-invalidation';

const COUNT_KEYS = [
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

type CountKey = (typeof COUNT_KEYS)[number];
type Summary = Record<CountKey, number>;
type QuizFinalizationClient = SupabaseClient<Database>;

type FinalizationStep =
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

const MISSING_RPC_CODES = new Set(['PGRST202']);

function emptySummary(): Summary {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as Summary;
}

function addPayload(summary: Summary, payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  for (const key of COUNT_KEYS) {
    const value = (payload as Record<string, unknown>)[key];
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      summary[key] += value;
    }
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

function summaryValue(payload: object, key: CountKey) {
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function runtimeGateRejected(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const result = payload as Record<string, unknown>;
  return (
    result.runtimeGateMatches === false || result.runtimeGateFresh === false
  );
}

function addStepPayload(
  summary: Summary,
  step: FinalizationStep,
  payload: unknown
) {
  if (step.name === 'promote_due_scheduled_quiz_events_service_v2') {
    if (
      typeof payload === 'number' &&
      Number.isSafeInteger(payload) &&
      payload >= 0
    ) {
      summary.scheduledPromoted += payload;
    }
    return;
  }
  if (
    step.name === 'process_due_quiz_deadlines_v2' &&
    runtimeGateRejected(payload)
  ) {
    summary.failed += 1;
  }
  addPayload(summary, payload);
}

function logRpcFailure(name: FinalizationStep['name'], error: PostgrestError) {
  // PostgREST's message, details, and hint may embed a rejected value. Do not
  // log any of them: finalization is a privileged worker and its errors can
  // include shopper PII or provider credentials. The stable RPC name and
  // database code are sufficient for operators to correlate the failure.
  logger.error({
    code: error.code || 'UNKNOWN',
    error: '[REDACTED]',
    message: 'Quiz finalization RPC failed',
    rpc: name,
  });
}

function runStep(client: QuizFinalizationClient, step: FinalizationStep) {
  switch (step.name) {
    case 'promote_due_scheduled_quiz_events_service_v2':
      return client.rpc('promote_due_scheduled_quiz_events_service_v2');
    case 'finalize_due_test_quiz_events_v2':
      return client.rpc('finalize_due_test_quiz_events_v2');
    case 'terminalize_due_live_quiz_events_v2':
      return client.rpc('terminalize_due_live_quiz_events_v2');
    case 'expire_unclaimed_ranked_quiz_awards_v2':
      return client.rpc('expire_unclaimed_ranked_quiz_awards_v2');
    case 'finalize_due_live_quiz_events_v2':
      return client.rpc('finalize_due_live_quiz_events_v2', step.args);
    case 'process_due_quiz_deadlines_v2':
      return client.rpc('process_due_quiz_deadlines_v2', step.args);
    case 'set_quiz_runtime_control_v2':
      return client.rpc('set_quiz_runtime_control_v2', step.args);
    case 'close_due_product_quiz_events':
      return client.rpc('close_due_product_quiz_events');
    case 'finalize_due_quiz_events':
      return client.rpc('finalize_due_quiz_events');
  }
}

export async function finalizeDueQuizEvents() {
  const summary = emptySummary();
  const client: QuizFinalizationClient = createAdminClient();
  const cacheInvalidationStartedAt = new Date().toISOString();
  const phaseIsProduction = getQuizPhaseEnv() === 'production';
  const productionApproved = getQuizProductionApprovedEnv();

  const deadlineArgs = {
    p_production_approved: productionApproved,
    p_production_phase: phaseIsProduction,
  };
  const deadlineStep: FinalizationStep = {
    name: 'process_due_quiz_deadlines_v2',
    args: deadlineArgs,
  };
  const runtimeGateStep: FinalizationStep = {
    name: 'set_quiz_runtime_control_v2',
    args: deadlineArgs,
  };
  const legacyDeadlineSteps: FinalizationStep[] = [
    { name: 'promote_due_scheduled_quiz_events_service_v2' },
    { name: 'finalize_due_test_quiz_events_v2' },
    { name: 'terminalize_due_live_quiz_events_v2' },
    {
      name: 'finalize_due_live_quiz_events_v2',
      args: deadlineArgs,
    },
  ];
  const maintenanceSteps: FinalizationStep[] = [
    { name: 'expire_unclaimed_ranked_quiz_awards_v2' },
    { name: 'close_due_product_quiz_events' },
  ];
  if (phaseIsProduction && productionApproved) {
    maintenanceSteps.push({ name: 'finalize_due_quiz_events' });
  }

  const runtimeGateResult = await runStep(client, runtimeGateStep);
  if (runtimeGateResult.error) {
    logRpcFailure(runtimeGateStep.name, runtimeGateResult.error);
    summary.failed += 1;
  } else {
    const deadlineResult = await runStep(client, deadlineStep);
    if (
      deadlineResult.error &&
      MISSING_RPC_CODES.has(deadlineResult.error.code)
    ) {
      // Deployments can briefly run the newer worker before its migration has
      // reached PostgREST. The old RPCs are idempotent, so retain them only as a
      // rollout compatibility path instead of failing every deadline cycle.
      for (const step of legacyDeadlineSteps) {
        const { data, error } = await runStep(client, step);
        if (error) {
          logRpcFailure(step.name, error);
          summary.failed += 1;
          continue;
        }
        addStepPayload(summary, step, data);
      }
    } else if (deadlineResult.error) {
      logRpcFailure(deadlineStep.name, deadlineResult.error);
      summary.failed += 1;
    } else {
      addStepPayload(summary, deadlineStep, deadlineResult.data);
    }
  }

  for (const step of maintenanceSteps) {
    const { data, error } = await runStep(client, step);
    if (error) {
      logRpcFailure(step.name, error);
      summary.failed += 1;
      // These RPCs work on separate, idempotent queues. Continue so one bad
      // operation cannot strand scheduled promotions, test closure, or award
      // expiry until the next worker run.
      continue;
    }
    addStepPayload(summary, step, data);
  }

  if (!phaseIsProduction || !productionApproved) {
    summary.skippedLive = summary.liveAwaitingGate;
  }

  await invalidateQuizProductCaches(client, cacheInvalidationStartedAt);

  if (summary.failed > 0) {
    return {
      body: {
        error: 'Quiz finalization failed',
        code: 'QUIZ_FINALIZATION_FAILED',
        ...summary,
      },
      status: 500,
    };
  }

  return { body: summary, status: 200 };
}
