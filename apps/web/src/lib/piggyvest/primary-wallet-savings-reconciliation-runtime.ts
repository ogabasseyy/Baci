import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createPrimaryWalletSavingsReconciliationStore } from './primary-wallet-savings-reconciliation-store';

export async function runPrimaryWalletSavingsReconciliation(input: {
  configuration: unknown;
  providerToken: unknown;
  operationId: unknown;
  fetchImplementation?: typeof fetch;
}) {
  const configuration = piggyvestPrimaryInflowRuntimeSchema.parse(
    input.configuration
  );
  const token = piggyvestPrimaryWalletRuntimeSchema.shape.providerToken.parse(
    input.providerToken
  );
  const store = createPrimaryWalletSavingsReconciliationStore({
    integrationId: configuration.integrationId,
    environment: configuration.environment,
    execute: createPrimaryWalletEvidenceExecutor(configuration),
  });
  return await reconcilePrimaryWalletSavings(input.operationId, {
    ...store,
    queryProvider: async ({ reference, walletId }) =>
      await requestPrefundedCardProviderJson({
        url: `${getPrimaryWalletProviderOrigin(configuration.environment)}/api/v1/transaction/verify?reference=${encodeURIComponent(reference)}&wallet_id=${encodeURIComponent(walletId)}`,
        token,
        timeoutMs: 10000,
        maxResponseBytes: 65536,
        fetchImplementation: input.fetchImplementation ?? fetch,
        init: { method: 'GET' },
      }),
  });
}
