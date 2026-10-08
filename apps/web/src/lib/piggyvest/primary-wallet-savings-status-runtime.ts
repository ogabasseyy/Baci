import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { runPrimaryWalletSavingsReconciliation } from './primary-wallet-savings-reconciliation-runtime';
import { createPrimaryWalletSavingsStore } from './primary-wallet-savings-store';

export async function checkPrimaryWalletSavingsStatus(input: {
  configuration: unknown;
  reconciliationConfiguration: unknown;
  scope: unknown;
  operationId: unknown;
  providerToken: unknown;
}) {
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse(
    input.configuration
  );
  const evidence = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.reconciliationConfiguration
  );
  const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
  const operationId =
    piggyvestPrimarySavingsTransferSchemas.request.shape.operationId.parse(
      input.operationId
    );
  const providerToken =
    piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
      input.providerToken
    );
  if (
    scope.integrationId !== configuration.integrationId ||
    scope.environment !== configuration.environment ||
    evidence.integrationId !== configuration.integrationId ||
    evidence.environment !== configuration.environment
  )
    throw new Error('Savings status binding unavailable');
  const store = createPrimaryWalletSavingsStore({
    scope,
    execute: createPrimaryWalletSavingsExecutor(configuration),
  });
  let state = await store.readStatus(operationId);
  if (state === 'reserved') {
    await store.cancelBeforeDispatch(operationId).catch(() => undefined);
    state = await store.readStatus(operationId);
  }
  if (state === null) return { status: 'not_found' as const };
  if (state === 'confirmed') return { status: 'confirmed' as const };
  if (state === 'cancelled') return { status: 'cancelled' as const };
  if (state === 'reserved') return { status: 'pending' as const };
  return await runPrimaryWalletSavingsReconciliation({
    configuration: evidence,
    operationId,
    providerToken,
  });
}
