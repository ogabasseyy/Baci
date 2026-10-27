import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { isExplicitUnsupportedSavingsDateFilterError } from './primary-wallet-savings-identity-date-filter-error';
import { primarySavingsIdentityDateWindow } from './primary-wallet-savings-identity-date-window';
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

    let directTransaction: z.infer<typeof schemas.singleTransaction> | null =
      null;
    let dateWindow: ReturnType<typeof primarySavingsIdentityDateWindow> = null;
    if (!isStaging) {
      let rawDirect: unknown;
      let directUnavailable = false;
      try {
        rawDirect = await getData(
          `/api/v1/transaction/${encodeURIComponent(actual.id)}?wallet_id=${encodeURIComponent(wallet.id)}`,
          limits.transactionResponseBytes,
          limits.locatorSearchReserveMs + limits.unfilteredFallbackReserveMs
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT'].includes(error.message)
        )
          return null;
        directUnavailable = true;
      }
      if (!directUnavailable) {
        const parsedDirect = schemas.singleTransaction.safeParse(rawDirect);
        if (!parsedDirect.success) return null;
        directTransaction = parsedDirect.data;
        if (
          directTransaction.id !== actual.id ||
          directTransaction.status !== 'successful' ||
          directTransaction.customer_id !== actual.customer_id ||
          directTransaction.source_wallet !== expected.sourceWalletId ||
          directTransaction.destination_wallet !==
            expected.destinationWalletId ||
          directTransaction.amount !== actual.amount ||
          directTransaction.reference !== actual.reference ||
          directTransaction.third_party_reference !== expected.reference ||
          directTransaction.fee !== 0 ||
          (directTransaction.internal_reference != null &&
            directTransaction.internal_reference !== actual.id)
        )
          return null;
        if (
          rawDirect &&
          typeof rawDirect === 'object' &&
          'created_at' in rawDirect
        )
          dateWindow = primarySavingsIdentityDateWindow(rawDirect.created_at);
      }
    }

    async function scanProductionList(
      window: ReturnType<typeof primarySavingsIdentityDateWindow>
    ): Promise<
      | { status: 'matched'; transaction: z.infer<typeof schemas.transaction> }
      | { status: 'not-found' | 'invalid' | 'unsupported' }
    > {
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
        if (window) {
          query.set('start_date', window.startDate);
          query.set('end_date', window.endDate);
        }
        if (cursor !== null) query.set('cursor', cursor);
        let data: unknown;
        try {
          data = await getData(
            `/api/v1/transaction?${query.toString()}`,
            limits.pageResponseBytes,
            window ? limits.unfilteredFallbackReserveMs : 0
          );
        } catch (error) {
          if (
            window &&
            (isExplicitUnsupportedSavingsDateFilterError(error) ||
              (error instanceof Error &&
                [
                  'PROVIDER_TIMEOUT',
                  'PROVIDER_UNAVAILABLE',
                  'SAVINGS_IDENTITY_DEADLINE',
                ].includes(error.message)))
          )
            return { status: 'unsupported' };
          return { status: 'invalid' };
        }
        const parsedPage = schemas.page.safeParse(data);
        if (!parsedPage.success) return { status: 'invalid' };
        const page = parsedPage.data;
        if (
          page.edges.length === 0 &&
          (page.pageInfo.hasNextPage || pageNumber > 0)
        )
          return { status: 'invalid' };
        let matchedCandidate: z.infer<typeof schemas.transaction> | null = null;
        for (const candidate of page.edges) {
          if (identifiers.has(candidate.id)) return { status: 'invalid' };
          identifiers.add(candidate.id);
          if (candidate.id !== actual.id) continue;
          if (transaction !== null || matchedCandidate !== null)
            return { status: 'invalid' };
          matchedCandidate =
            schemas.transaction.safeParse(candidate).data ?? null;
          if (
            !matchedCandidate ||
            matchedCandidate.business_id !== expected.businessId ||
            matchedCandidate.wallet_id !== wallet.id ||
            matchedCandidate.api_customer_id !== expected.providerCustomerId ||
            matchedCandidate.amount !== -expected.amountKobo ||
            matchedCandidate.third_party_reference !== expected.reference ||
            matchedCandidate.provider_reference !== actual.reference
          )
            return { status: 'invalid' };
        }
        cursor = page.pageInfo.endCursor;
        if (cursor !== null) {
          if (cursors.has(cursor)) return { status: 'invalid' };
          cursors.add(cursor);
        }
        if (matchedCandidate !== null) {
          if (page.pageInfo.hasNextPage && directTransaction)
            return { status: 'matched', transaction: matchedCandidate };
          transaction = matchedCandidate;
        }
        if (!page.pageInfo.hasNextPage)
          return transaction === null
            ? { status: 'not-found' }
            : { status: 'matched', transaction };
      }
      return { status: 'invalid' };
    }

    if (dateWindow) {
      const located = await scanProductionList(dateWindow);
      if (located.status === 'matched')
        return schemas.evidence.parse({
          environment: 'production',
          wallet,
          transaction: located.transaction,
        });
      if (located.status === 'invalid') return null;
    }
    const scanned = await scanProductionList(null);
    return scanned.status === 'matched'
      ? schemas.evidence.parse({
          environment: 'production',
          wallet,
          transaction: scanned.transaction,
        })
      : null;
  } catch {
    return null;
  }
}
