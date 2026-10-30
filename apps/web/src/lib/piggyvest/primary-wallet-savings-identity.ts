import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';

export async function resolvePrimaryWalletSavingsIdentity(input: {
  reservation: unknown;
  providerResponse: unknown;
  environment: unknown;
  token: string;
  fetchImplementation?: typeof fetch;
  checkpointScope?: { integrationId: string; environment: 'production' };
  checkpoint?: {
    state: z.infer<typeof checkpointSchemas.state>;
    save: (state: z.infer<typeof checkpointSchemas.state>) => Promise<boolean>;
  };
}): Promise<unknown | null> {
  try {
    const expected = piggyvestPrimarySavingsTransferSchemas.reserved.parse(
      input.reservation
    );
    const success = prefundedCardTransferVerificationSchemas.rich.safeParse(
      input.providerResponse
    );
    const failure = success.success
      ? null
      : prefundedCardTransferVerificationSchemas.richFailed.safeParse(
          input.providerResponse
        );
    if (!success.success && !failure?.success) return null;
    const actual = (success.success ? success.data : failure?.data)?.data;
    if (!actual) return null;
    const origin = getPrimaryWalletProviderOrigin(input.environment);
    const isStaging = origin === 'https://staging.piggyvest.business';
    const customerIdentityMatches = isStaging
      ? [expected.businessId, expected.providerCustomerId].includes(
          actual.customer_id
        )
      : actual.customer_id === expected.businessId &&
        actual.customer_id !== expected.providerCustomerId;
    if (
      !input.token.trim() ||
      !customerIdentityMatches ||
      actual.amount !== expected.amountKobo ||
      actual.third_party_reference !== expected.reference ||
      actual.source_wallet !== expected.sourceWalletId ||
      actual.destination_wallet !== expected.destinationWalletId ||
      (actual.business_id !== undefined &&
        actual.business_id !== expected.businessId) ||
      (actual.currency !== undefined && actual.currency !== 'NGN') ||
      (actual.destination_customer_id !== undefined &&
        actual.destination_customer_id !== expected.providerCustomerId)
    )
      return null;

    const deadline = performance.now() + limits.timeBudgetMs;

    async function getData(
      path: string,
      maxResponseBytes: number,
      reserveAfterMs = 0
    ) {
      const remainingMs = deadline - performance.now() - reserveAfterMs;
      if (remainingMs < 1) throw new Error('SAVINGS_IDENTITY_DEADLINE');
      const response = await requestPrefundedCardProviderJson({
        url: `${origin}${path}`,
        token: input.token,
        timeoutMs: Math.min(limits.requestTimeoutMs, Math.floor(remainingMs)),
        maxResponseBytes,
        fetchImplementation: input.fetchImplementation ?? fetch,
        init: { method: 'GET' },
      });
      if (performance.now() >= deadline)
        throw new Error('SAVINGS_IDENTITY_DEADLINE');
      if (
        !response ||
        typeof response !== 'object' ||
        !('status' in response) ||
        response.status !== true ||
        !('data' in response)
      )
        throw new Error('SAVINGS_IDENTITY_UNAVAILABLE');
      return response.data;
    }

    const wallet = schemas.wallet.parse(
      await getData(
        `/api/v1/wallet/${encodeURIComponent(expected.sourceWalletId)}`,
        limits.walletResponseBytes,
        isStaging ? 0 : limits.walletFollowupReserveMs
      )
    );
    if (
      wallet.id !== expected.sourceWalletId ||
      wallet.business_id !== expected.businessId ||
      wallet.api_customer_id !== expected.providerCustomerId
    )
      return null;

    const checkpoint = input.checkpoint
      ? { state: input.checkpoint.state, save: input.checkpoint.save }
      : undefined;
    if (checkpoint && !(await checkpoint.save(checkpointSchemas.emptyState)))
      return null;

    if (isStaging) {
      if (!success.success) return null;
      const transaction = schemas.singleTransaction.parse(
        await getData(
          `/api/v1/transaction/${encodeURIComponent(actual.id)}?wallet_id=${encodeURIComponent(wallet.id)}`,
          limits.transactionResponseBytes
        )
      );
      if (
        transaction.id !== actual.id ||
        transaction.status !== 'successful' ||
        transaction.customer_id !== actual.customer_id ||
        transaction.source_wallet !== expected.sourceWalletId ||
        transaction.destination_wallet !== expected.destinationWalletId ||
        transaction.amount !== actual.amount ||
        transaction.fee !== 0 ||
        transaction.reference !== actual.reference ||
        transaction.third_party_reference !== expected.reference ||
        (transaction.internal_reference != null &&
          transaction.internal_reference !== actual.id)
      )
        return null;
      return schemas.evidence.parse({
        environment: 'staging',
        wallet,
        transaction,
      });
    }

    let direct: unknown;
    try {
      direct = await getData(
        `/api/v1/transaction/${encodeURIComponent(actual.id)}?wallet_id=${encodeURIComponent(wallet.id)}`,
        limits.transactionResponseBytes
      );
    } catch {
      return null;
    }
    const parsedDirect = schemas.productionSingleTransaction.safeParse(direct);
    if (!parsedDirect.success) return null;
    const transaction = parsedDirect.data;
    if (
      transaction.id !== actual.id ||
      transaction.status !== actual.status ||
      transaction.category !== 'p2p' ||
      transaction.customer_id !== actual.customer_id ||
      transaction.source_wallet !== expected.sourceWalletId ||
      transaction.destination_wallet !== expected.destinationWalletId ||
      transaction.amount !== actual.amount ||
      transaction.reference !== actual.reference ||
      transaction.third_party_reference !== expected.reference ||
      transaction.fee !== 0 ||
      (transaction.internal_reference != null &&
        transaction.internal_reference !== actual.id)
    )
      return null;
    return schemas.evidence.parse({
      environment: 'production',
      wallet,
      transaction,
    });
  } catch {
    return null;
  }
}
