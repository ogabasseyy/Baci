import 'server-only';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { resolvePrimaryWalletSavingsIdentity } from './primary-wallet-savings-identity';
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

export function createPrimaryWalletSavingsIdentityResolver(input: {
  environment: 'staging' | 'production';
  integrationId: string;
  token: string;
  store: ReturnType<typeof createPrimaryWalletSavingsReconciliationStore>;
  fetchImplementation?: typeof fetch;
}) {
  type IdentityCheckpoint = NonNullable<
    Parameters<typeof resolvePrimaryWalletSavingsIdentity>[0]['checkpoint']
  >;
  return (selection: { reservation: unknown; providerResponse: unknown }) => {
    const resolve = (checkpoint?: IdentityCheckpoint) =>
      resolvePrimaryWalletSavingsIdentity({
        ...selection,
        environment: input.environment,
        token: input.token,
        fetchImplementation: input.fetchImplementation,
        checkpoint,
        checkpointScope:
          input.environment === 'production'
            ? { integrationId: input.integrationId, environment: 'production' }
            : undefined,
      });
    if (input.environment === 'staging') return resolve();
    const reservation = piggyvestPrimarySavingsTransferSchemas.reserved.parse(
      selection.reservation
    );
    return input.store.withIdentityCheckpoint(reservation.operationId, resolve);
  };
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
    environment: configuration.environment,
    ...store,
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token,
      fetchImplementation: input.fetchImplementation,
    }),
    resolveIdentity: createPrimaryWalletSavingsIdentityResolver({
      environment: configuration.environment,
      integrationId: configuration.integrationId,
      token,
      store,
      fetchImplementation: input.fetchImplementation,
    }),
  });
}
