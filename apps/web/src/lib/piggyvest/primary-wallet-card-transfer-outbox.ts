import 'server-only';
import { primaryCardTransferOutboxSchema } from '@/schemas/primary-wallet-card-transfer-outbox';
import { createPrimaryCardCustodyExecutor } from './primary-wallet-card-custody-executor';
import { dispatchPrimaryCardProviderTransfer } from './primary-wallet-card-transfer-dispatch';
import { readPrimaryCardTransferRuntime } from './primary-wallet-card-transfer-runtime';

export async function runPrimaryCardTransferOutbox(input: {
  mode: 'readiness' | 'once';
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<{
  mode: 'readiness' | 'once';
  status:
    | 'reconciliation_required'
    | 'approved_policy_and_storage_ready'
    | 'submitted_for_custody'
    | 'raced'
    | 'idle';
  selectedCount: number;
  submittedCount: number;
  unknownCount: number;
  dispatchingCount: number;
  fundingComplete: false;
}> {
  const environment = { ...(input.environment ?? process.env) };
  const clock = input.now ?? Date.now;
  const configuration = readPrimaryCardTransferRuntime(environment, clock());
  if (!configuration)
    throw new Error('Primary card transfer configuration unavailable');
  input.signal?.throwIfAborted();
  const runtime = configuration.runtime;
  const execute = createPrimaryCardCustodyExecutor(runtime);
  const selected = primaryCardTransferOutboxSchema.parse(
    await execute('selectReadyTransfers', [
      JSON.stringify({
        ...runtime.crosswalkAuthority,
        merchantId: runtime.merchantId,
        businessId: runtime.businessId,
        expiresAt: runtime.expiresAt,
      }),
      input.mode === 'once' ? '1' : '0',
    ])
  );
  if (input.mode === 'readiness' && selected.operationIds.length !== 0)
    throw new Error('Invalid readiness selection');
  input.signal?.throwIfAborted();
  const reconciliationRequired =
    selected.unknownCount > 0 || selected.dispatchingCount > 0;
  const operationId = selected.operationIds[0];
  // Drain the selected ready operation even while unrelated operations
  // await reconciliation: selection, claim, and the provider reference
  // are all per-operation, so one ambiguous transfer must not stall the
  // integration-wide outbox. The status below still reports
  // reconciliation_required until the stuck counts clear.
  const outcome = operationId
    ? await dispatchPrimaryCardProviderTransfer({
        operationId,
        environment,
        fetchImplementation: input.fetchImplementation,
        now: clock,
        signal: input.signal,
      })
    : null;
  return {
    mode: input.mode,
    status:
      reconciliationRequired || outcome === 'unknown'
        ? 'reconciliation_required'
        : input.mode === 'readiness'
          ? 'approved_policy_and_storage_ready'
          : outcome === 'submitted'
            ? 'submitted_for_custody'
            : outcome === 'existing'
              ? 'raced'
              : 'idle',
    selectedCount: selected.operationIds.length,
    submittedCount: outcome === 'submitted' ? 1 : 0,
    unknownCount: selected.unknownCount + (outcome === 'unknown' ? 1 : 0),
    dispatchingCount: selected.dispatchingCount,
    fundingComplete: false,
  };
}
