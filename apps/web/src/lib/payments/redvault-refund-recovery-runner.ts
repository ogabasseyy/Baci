import type {
  RedvaultRefundProvider,
  RedvaultRefundReconciliationProvider,
} from './redvault-refund-orchestrator';
import {
  processNextRedvaultRefund,
  reconcileNextRedvaultRefund,
} from './redvault-refund-orchestrator';
import type { RedvaultRefundStore } from './redvault-refund-store';

export const REDVAULT_TEST_REFUND_APPLY_GUARD = 'apply-redvault-test-refunds';
export const REDVAULT_PRODUCTION_REFUND_APPLY_GUARD =
  'apply-redvault-production-refunds';

type RedvaultRefundRecoveryLogger = {
  error: (entry: Record<string, string>) => void;
  info: (entry: Record<string, string>) => void;
};

type RedvaultRefundRecoveryStore = Pick<
  RedvaultRefundStore,
  | 'claimNext'
  | 'finish'
  | 'recordProviderSubmission'
  | 'markSubmissionIndeterminate'
  | 'claimNextReconciliation'
  | 'reconcile'
>;

export type RedvaultRefundRecoveryRun = {
  reconciliation: string;
  submission: string;
};

function logOutcome({
  logger,
  operation,
  outcome,
}: {
  logger: RedvaultRefundRecoveryLogger;
  operation: 'reconciliation' | 'submission';
  outcome: string;
}) {
  logger.info({
    event: 'redvault_refund_recovery',
    operation,
    outcome,
  });
}

async function runSubmission({
  logger,
  provider,
  store,
}: {
  logger: RedvaultRefundRecoveryLogger;
  provider: RedvaultRefundProvider;
  store: Pick<
    RedvaultRefundRecoveryStore,
    | 'claimNext'
    | 'finish'
    | 'recordProviderSubmission'
    | 'markSubmissionIndeterminate'
  >;
}): Promise<string> {
  try {
    const outcome = await processNextRedvaultRefund({ provider, store });
    logOutcome({ logger, operation: 'submission', outcome: outcome.kind });
    return outcome.kind;
  } catch {
    logger.error({
      event: 'redvault_refund_recovery',
      operation: 'submission',
      outcome: 'transport_or_provider_error',
    });
    return 'transport_or_provider_error';
  }
}

async function runReconciliation({
  logger,
  provider,
  store,
}: {
  logger: RedvaultRefundRecoveryLogger;
  provider: RedvaultRefundReconciliationProvider;
  store: Pick<
    RedvaultRefundRecoveryStore,
    'claimNextReconciliation' | 'reconcile'
  >;
}): Promise<string> {
  try {
    const outcome = await reconcileNextRedvaultRefund({ provider, store });
    logOutcome({ logger, operation: 'reconciliation', outcome: outcome.kind });
    return outcome.kind;
  } catch {
    logger.error({
      event: 'redvault_refund_recovery',
      operation: 'reconciliation',
      outcome: 'transport_or_provider_error',
    });
    return 'transport_or_provider_error';
  }
}

export async function runRedvaultRefundRecovery({
  applyGuard,
  logger,
  mode = 'dry-run',
  provider,
  providerEnvironment,
  store,
}: {
  applyGuard?: string;
  logger: RedvaultRefundRecoveryLogger;
  mode?: string;
  provider: RedvaultRefundProvider & RedvaultRefundReconciliationProvider;
  providerEnvironment: 'production' | 'test';
  store: RedvaultRefundRecoveryStore;
}): Promise<RedvaultRefundRecoveryRun> {
  if (mode === 'dry-run') {
    logOutcome({ logger, operation: 'submission', outcome: 'dry_run' });
    logOutcome({ logger, operation: 'reconciliation', outcome: 'dry_run' });
    return { reconciliation: 'dry_run', submission: 'dry_run' };
  }

  if (mode !== 'apply') {
    logger.error({
      event: 'redvault_refund_recovery',
      operation: 'apply',
      outcome: 'invalid_mode',
    });
    return { reconciliation: 'invalid_mode', submission: 'invalid_mode' };
  }

  // Each environment has its own explicit guard string so a test harness
  // can never drive the live provider by accident, and production callers
  // must opt in deliberately. Unknown environments are refused outright.
  const expectedGuard =
    providerEnvironment === 'production'
      ? REDVAULT_PRODUCTION_REFUND_APPLY_GUARD
      : providerEnvironment === 'test'
        ? REDVAULT_TEST_REFUND_APPLY_GUARD
        : null;
  if (expectedGuard === null || applyGuard !== expectedGuard) {
    logger.error({
      event: 'redvault_refund_recovery',
      operation: 'apply',
      outcome: 'apply_guard_required',
    });
    return {
      reconciliation: 'apply_guard_required',
      submission: 'apply_guard_required',
    };
  }

  return {
    submission: await runSubmission({ logger, provider, store }),
    reconciliation: await runReconciliation({ logger, provider, store }),
  };
}
