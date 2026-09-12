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

type RedvaultRefundRecoveryLogger = {
  error: (entry: Record<string, string>) => void;
  info: (entry: Record<string, string>) => void;
};

type RedvaultRefundRecoveryStore = Pick<
  RedvaultRefundStore,
  | 'claimNext'
  | 'finish'
  | 'recordProviderSubmission'
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
    'claimNext' | 'finish' | 'recordProviderSubmission'
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

  if (applyGuard !== REDVAULT_TEST_REFUND_APPLY_GUARD) {
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

  if (providerEnvironment !== 'test') {
    logger.error({
      event: 'redvault_refund_recovery',
      operation: 'apply',
      outcome: 'test_provider_required',
    });
    return {
      reconciliation: 'test_provider_required',
      submission: 'test_provider_required',
    };
  }

  return {
    submission: await runSubmission({ logger, provider, store }),
    reconciliation: await runReconciliation({ logger, provider, store }),
  };
}
