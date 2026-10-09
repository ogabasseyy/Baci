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
import { resubmitReclaimedSavingsDispatch } from './primary-wallet-savings-transfer';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { retrievePiggyvestWallet } from './wallets';

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
  // A dispatched operation whose holder died before the provider
  // request pins the wallet hold and goal slot: reconciliation can
  // only report pending for a reference that was never submitted, and
  // the client polls status without ever re-posting. Drive the
  // lookup-gated reclaim here instead: adoptPending returns 'existing'
  // for a live holder's fresh dispatch (untouched), and only a
  // proven-absent reference resubmits. Any failure falls through to
  // reconciliation, which settles submitted transfers as before.
  await driveStaleDispatchReclaim({
    scope,
    operationId,
    provider: {
      token: providerToken,
      baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
    },
    adoptPending: (id) => store.adoptPending(id),
  }).catch(() => undefined);
  return await runPrimaryWalletSavingsReconciliation({
    configuration: evidence,
    operationId,
    providerToken,
  });
}

async function driveStaleDispatchReclaim(input: {
  scope: { businessId: string };
  operationId: string;
  provider: { token: string; baseUrl: string };
  adoptPending: (
    operationId: string
  ) => Promise<
    | { status: 'adopted' | 'reclaimed'; reservation: unknown }
    | { status: 'existing' }
  >;
}) {
  const adoption = await input.adoptPending(input.operationId);
  if (adoption.status !== 'reclaimed') return;
  const reservation = piggyvestPrimarySavingsTransferSchemas.reserved.parse(
    adoption.reservation
  );
  if (reservation.businessId !== input.scope.businessId)
    throw new Error('Savings ownership unavailable');
  await resubmitReclaimedSavingsDispatch(reservation, {
    lookupTransfer: async (candidate) =>
      await lookupSavingsTransferReference({
        reference: candidate.reference,
        walletId: candidate.sourceWalletId,
        amountKobo: candidate.amountKobo,
        destinationWalletId: candidate.destinationWalletId,
        token: input.provider.token,
        baseUrl: input.provider.baseUrl,
      }),
    retrieveWallet: async (walletId) =>
      await retrievePiggyvestWallet(input.provider, walletId),
    transfer: async (candidate) =>
      await transferToWallet(input.provider, {
        amountKobo: candidate.amountKobo,
        sourceWalletId: candidate.sourceWalletId,
        destinationWalletId: candidate.destinationWalletId,
        reference: candidate.reference,
        narration: 'Savings contribution',
      }),
  });
}
