import 'server-only';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { createPrimaryWalletSavingsStore } from './primary-wallet-savings-store';

export async function recoverPrimaryWalletSavings(input: {
  configuration: unknown;
  scope: unknown;
  goalId: unknown;
}) {
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse(
    input.configuration
  );
  const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
  const goalId =
    piggyvestPrimarySavingsTransferSchemas.request.shape.goalId.parse(
      input.goalId
    );
  if (
    scope.integrationId !== configuration.integrationId ||
    scope.environment !== configuration.environment
  )
    throw new Error('Savings recovery binding unavailable');
  return await createPrimaryWalletSavingsStore({
    scope,
    execute: createPrimaryWalletSavingsExecutor(configuration),
  }).recoverPending(goalId);
}
