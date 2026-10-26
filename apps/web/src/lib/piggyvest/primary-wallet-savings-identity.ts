import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';

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
    if (
      !input.token.trim() ||
      actual.customer_id !== expected.businessId ||
      actual.customer_id === expected.providerCustomerId ||
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

    const origin = getPrimaryWalletProviderOrigin(input.environment);
    async function getData(path: string, maxResponseBytes: number) {
      const response = await requestPrefundedCardProviderJson({
        url: `${origin}${path}`,
        token: input.token,
        timeoutMs: 10000,
        maxResponseBytes,
        fetchImplementation: input.fetchImplementation ?? fetch,
        init: { method: 'GET' },
      });
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
        65536
      )
    );
    if (
      wallet.id !== expected.sourceWalletId ||
      wallet.business_id !== expected.businessId ||
      wallet.api_customer_id !== expected.providerCustomerId
    )
      return null;

    let transaction: z.infer<typeof schemas.transaction> | null = null;
    let cursor: string | null = null;
    const cursors = new Set<string>();
    const identifiers = new Set<string>();
    for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
      const query = new URLSearchParams({
        wallet_id: wallet.id,
        limit: '100',
        collapse_batch: '0',
      });
      if (cursor !== null) query.set('cursor', cursor);
      const page = schemas.page.parse(
        await getData(`/api/v1/transaction?${query.toString()}`, 1048576)
      );
      if (
        page.edges.length === 0 &&
        (page.pageInfo.hasNextPage || pageNumber > 0)
      )
        return null;
      for (const candidate of page.edges) {
        if (identifiers.has(candidate.id)) return null;
        identifiers.add(candidate.id);
        if (candidate.id !== actual.id) continue;
        if (transaction !== null) return null;
        transaction = schemas.transaction.parse(candidate);
        if (
          transaction.business_id !== expected.businessId ||
          transaction.wallet_id !== wallet.id ||
          transaction.api_customer_id !== expected.providerCustomerId ||
          transaction.amount !== -expected.amountKobo ||
          transaction.third_party_reference !== expected.reference ||
          transaction.provider_reference !== actual.reference
        )
          return null;
      }
      cursor = page.pageInfo.endCursor;
      if (cursor !== null) {
        if (cursors.has(cursor)) return null;
        cursors.add(cursor);
      }
      if (!page.pageInfo.hasNextPage)
        return transaction === null
          ? null
          : schemas.evidence.parse({ wallet, transaction });
    }
    return null;
  } catch {
    return null;
  }
}
