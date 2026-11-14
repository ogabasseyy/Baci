import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  getQuizPhaseEnv,
  getQuizProductionApprovedEnv,
} from '@/lib/quiz/quiz-runtime-env';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/types/supabase';
import {
  addStepPayload,
  emptySummary,
  type FinalizationStep,
  hasQuizMutations,
  type MutationTrackingState,
} from './quiz-finalization-summary';
import { invalidateQuizProductCaches } from './quiz-product-cache-invalidation';
import {
  hasQuizSweepWatermarksChanged,
  type QuizSweepWatermarks,
} from './quiz-sweep-boundary-state';
import { resolveQuizSweepWatermarks } from './quiz-sweep-watermarks';

type QuizFinalizationClient = SupabaseClient<Database>;

const MISSING_RPC_CODES = new Set(['PGRST202']);

let lastObservedWatermarks: QuizSweepWatermarks | null = null;
let hasPendingRecoverySweep = false;

export function resetQuizSweepStateForTests() {
  lastObservedWatermarks = null;
  hasPendingRecoverySweep = false;
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
  const mutationState: MutationTrackingState = {
    hasUnknownMutationResult: false,
    scalarMutationCount: 0,
  };
  const client: QuizFinalizationClient = createAdminClient();
  const cacheInvalidationStartedAt = new Date().toISOString();
  const phaseIsProduction = getQuizPhaseEnv() === 'production';
  const productionApproved = getQuizProductionApprovedEnv();

  // Capture pre-RPC sweep floors and boundary row snapshots before any RPC
  // runs so idle ticks skip post-RPC sweeps completely and real mutations at
  // the boundary timestamp are never missed.
  const sweepWatermarks = await resolveQuizSweepWatermarks(
    client,
    cacheInvalidationStartedAt
  );

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
        addStepPayload(summary, mutationState, step, data);
      }
    } else if (deadlineResult.error) {
      logRpcFailure(deadlineStep.name, deadlineResult.error);
      summary.failed += 1;
    } else {
      addStepPayload(summary, mutationState, deadlineStep, deadlineResult.data);
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
    addStepPayload(summary, mutationState, step, data);
  }

  if (!phaseIsProduction || !productionApproved) {
    summary.skippedLive = summary.liveAwaitingGate;
  }

  const hasLocalMutationOrFailure =
    hasQuizMutations(summary, mutationState) ||
    mutationState.hasUnknownMutationResult ||
    summary.failed > 0 ||
    sweepWatermarks.hasProbeFailure;
  const hasExternalMutationSinceLastTick =
    lastObservedWatermarks !== null &&
    hasQuizSweepWatermarksChanged(lastObservedWatermarks, sweepWatermarks);
  const shouldSweepCaches =
    hasLocalMutationOrFailure ||
    hasExternalMutationSinceLastTick ||
    hasPendingRecoverySweep;

  if (shouldSweepCaches) {
    const sweepTargetWatermarks =
      (hasExternalMutationSinceLastTick || hasPendingRecoverySweep) &&
      lastObservedWatermarks !== null
        ? lastObservedWatermarks
        : sweepWatermarks;
    await invalidateQuizProductCaches(client, sweepTargetWatermarks);

    if (sweepWatermarks.hasProbeFailure) {
      hasPendingRecoverySweep = true;
    } else {
      hasPendingRecoverySweep = false;
      lastObservedWatermarks = sweepWatermarks;
    }
  } else if (!sweepWatermarks.hasProbeFailure) {
    lastObservedWatermarks = sweepWatermarks;
  }

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
