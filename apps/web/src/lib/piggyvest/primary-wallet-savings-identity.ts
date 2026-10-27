import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';

export async function resolvePrimaryWalletSavingsIdentity(input: {
  reservation: unknown;
  providerResponse: unknown;
  environment: unknown;
  token: string;
  fetchImplementation?: typeof fetch;
}): Promise<unknown | null> {
  try {
    const expected = piggyvestPrimarySavingsTransferSchemas.reserved.parse(
      input.reservation
    );
    const actual = prefundedCardTransferVerificationSchemas.rich.parse(
      input.providerResponse
    ).data;
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

    async function getData(path: string, maxResponseBytes: number) {
      const remainingMs = deadline - performance.now();
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
        limits.walletResponseBytes
      )
    );
    if (
      wallet.id !== expected.sourceWalletId ||
      wallet.business_id !== expected.businessId ||
      wallet.api_customer_id !== expected.providerCustomerId
    )
      return null;

    if (isStaging) {
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

    async function corroborateProductionCandidate(
      candidate: z.infer<typeof schemas.transaction>
    ): Promise<boolean> {
      const direct = schemas.singleTransaction.parse(
        await getData(
          `/api/v1/transaction/${encodeURIComponent(candidate.id)}?wallet_id=${encodeURIComponent(wallet.id)}`,
          limits.transactionResponseBytes
        )
      );
      return (
        direct.id === candidate.id &&
        direct.status === 'successful' &&
        direct.customer_id === actual.customer_id &&
        direct.source_wallet === expected.sourceWalletId &&
        direct.destination_wallet === expected.destinationWalletId &&
        direct.amount === actual.amount &&
        direct.reference === actual.reference &&
        direct.third_party_reference === expected.reference &&
        direct.fee === 0 &&
        (direct.internal_reference == null ||
          direct.internal_reference === candidate.id)
      );
    }

    let transaction: z.infer<typeof schemas.transaction> | null = null;
    let cursor: string | null = null;
    const cursors = new Set<string>();
    const identifiers = new Set<string>();
    for (let pageNumber = 0; pageNumber < limits.maxPages; pageNumber++) {
      const query = new URLSearchParams({
        wallet_id: wallet.id,
        limit: String(limits.pageSize),
        collapse_batch: '0',
      });
      if (cursor !== null) query.set('cursor', cursor);
      const page = schemas.page.parse(
        await getData(
          `/api/v1/transaction?${query.toString()}`,
          limits.pageResponseBytes
        )
      );
      if (
        page.edges.length === 0 &&
        (page.pageInfo.hasNextPage || pageNumber > 0)
      )
        return null;
      let matchedCandidate: z.infer<typeof schemas.transaction> | null = null;
      for (const candidate of page.edges) {
        if (identifiers.has(candidate.id)) return null;
        identifiers.add(candidate.id);
        if (candidate.id !== actual.id) continue;
        if (transaction !== null || matchedCandidate !== null) return null;
        matchedCandidate = schemas.transaction.parse(candidate);
        if (
          matchedCandidate.business_id !== expected.businessId ||
          matchedCandidate.wallet_id !== wallet.id ||
          matchedCandidate.api_customer_id !== expected.providerCustomerId ||
          matchedCandidate.amount !== -expected.amountKobo ||
          matchedCandidate.third_party_reference !== expected.reference ||
          matchedCandidate.provider_reference !== actual.reference
        )
          return null;
      }
      cursor = page.pageInfo.endCursor;
      if (cursor !== null) {
        if (cursors.has(cursor)) return null;
        cursors.add(cursor);
      }
      if (matchedCandidate !== null) {
        if (page.pageInfo.hasNextPage) {
          if (!(await corroborateProductionCandidate(matchedCandidate)))
            return null;
          return schemas.evidence.parse({
            environment: 'production',
            wallet,
            transaction: matchedCandidate,
          });
        }
        transaction = matchedCandidate;
      }
      if (!page.pageInfo.hasNextPage)
        return transaction === null
          ? null
          : schemas.evidence.parse({
              environment: 'production',
              wallet,
              transaction,
            });
    }
    return null;
  } catch {
    return null;
  }
}
