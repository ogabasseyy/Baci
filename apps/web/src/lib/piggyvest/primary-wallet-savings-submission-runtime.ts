import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { runPrimaryWalletSavingsReconciliation } from './primary-wallet-savings-reconciliation-runtime';
import { createPrimaryWalletSavingsStore } from './primary-wallet-savings-store';
import { submitPrimaryWalletSavingsTransfer } from './primary-wallet-savings-transfer';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { retrievePiggyvestWallet } from './wallets';

export async function submitPrimaryWalletSavings(input: {
  configuration: unknown;
  scope: unknown;
  request: unknown;
  providerToken: unknown;
  reconciliationConfiguration?: unknown;
}) {
  const configuration = piggyvestPrimarySavingsRuntimeSchema.parse(
    input.configuration
  );
  const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(input.scope);
  const request = piggyvestPrimarySavingsTransferSchemas.request.parse(
    input.request
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  if (
    scope.integrationId !== configuration.integrationId ||
    scope.environment !== configuration.environment
  )
    throw new Error('Savings binding unavailable');
  const store = createPrimaryWalletSavingsStore({
    scope,
    execute: createPrimaryWalletSavingsExecutor(configuration),
  });
  const provider = {
    token,
    baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
  };
  const evidence =
    input.reconciliationConfiguration === undefined
      ? null
      : piggyvestPrimaryInflowRuntimeSchema.parse(
          input.reconciliationConfiguration
        );
  if (
    evidence &&
    (evidence.integrationId !== configuration.integrationId ||
      evidence.environment !== configuration.environment)
  )
    throw new Error('Savings evidence binding unavailable');
  const result = await submitPrimaryWalletSavingsTransfer(request, {
    ...store,
    reserve: async (selection) => {
      const result = await store.reserve(selection);
      if (result.status === 'claimed') {
        const reservation =
          piggyvestPrimarySavingsTransferSchemas.reserved.parse(
            result.reservation
          );
        if (reservation.businessId !== scope.businessId)
          throw new Error('Savings ownership unavailable');
      }
      return result;
    },
    lookupTransfer: async (reservation) =>
      await lookupSavingsTransferReference({
        reference: reservation.reference,
        walletId: reservation.sourceWalletId,
        amountKobo: reservation.amountKobo,
        destinationWalletId: reservation.destinationWalletId,
        token: provider.token,
        baseUrl: provider.baseUrl,
      }),
    retrieveWallet: async (walletId) =>
      await retrievePiggyvestWallet(provider, walletId),
    transfer: async (reservation) =>
      await transferToWallet(provider, {
        amountKobo: reservation.amountKobo,
        sourceWalletId: reservation.sourceWalletId,
        destinationWalletId: reservation.destinationWalletId,
        reference: reservation.reference,
        narration: 'Savings contribution',
      }),
  });
  if (result.status !== 'pending' || !evidence) return result;
  try {
    return await runPrimaryWalletSavingsReconciliation({
      configuration: evidence,
      providerToken: token,
      operationId: request.operationId,
    });
  } catch {
    return result;
  }
}
