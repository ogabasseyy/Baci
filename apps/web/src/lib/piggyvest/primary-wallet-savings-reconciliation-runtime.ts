import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { reconcilePrimaryWalletSavings } from './primary-wallet-savings-reconciliation';
import { createPrimaryWalletSavingsReconciliationStore } from './primary-wallet-savings-reconciliation-store';

// Shared verify-query port: the client status path and the webhook outflow
// path must interrogate the provider identically, or the same transfer could
// confirm on one path and hang on the other.
export function createSavingsVerifyQueryProvider(input: {
  environment: unknown;
  token: string;
  fetchImplementation?: typeof fetch;
}) {
  return async ({
    reference,
    walletId,
  }: {
    reference: string;
    walletId: string;
  }) =>
    await requestPrefundedCardProviderJson({
      url: `${getPrimaryWalletProviderOrigin(input.environment)}/api/v1/transaction/verify?reference=${encodeURIComponent(reference)}&wallet_id=${encodeURIComponent(walletId)}`,
      token: input.token,
      timeoutMs: 10000,
      maxResponseBytes: 65536,
      fetchImplementation: input.fetchImplementation ?? fetch,
      init: { method: 'GET' },
    });
}

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
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token,
      fetchImplementation: input.fetchImplementation,
    }),
  });
}
