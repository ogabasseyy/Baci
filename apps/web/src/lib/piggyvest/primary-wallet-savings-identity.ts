import 'server-only';
import type { z } from 'zod';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { primarySavingsIdentityDateWindow } from './primary-wallet-savings-identity-date-window';
import { primaryWalletSavingsIdentityLimits as limits } from './primary-wallet-savings-identity-limits';
import {
  primarySavingsIdentityCheckpointFingerprint,
  scanPrimarySavingsIdentityList,
} from './primary-wallet-savings-identity-scan';

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

    if (input.checkpoint && (!directTransaction || !input.checkpointScope))
      return null;
    const checkpoint = input.checkpoint
      ? { state: input.checkpoint.state, save: input.checkpoint.save }
      : undefined;
    const resetCheckpoint = async () => {
      if (!checkpoint) return true;
      if (!(await checkpoint.save(checkpointSchemas.emptyState)))
        throw new Error('Savings checkpoint fence lost');
      return true;
    };
    const scan = (
      window: ReturnType<typeof primarySavingsIdentityDateWindow>,
      stage: 'date-window' | 'full'
    ) =>
      scanPrimarySavingsIdentityList({
        getData,
        reservation: expected,
        actual,
        direct: directTransaction ?? undefined,
        walletId: wallet.id,
        scope: input.checkpointScope,
        stage,
        window,
        checkpoint,
        pageSize: limits.pageSize,
        maxPages: limits.maxPages,
        pageResponseBytes: limits.pageResponseBytes,
        fallbackReserveMs: limits.unfilteredFallbackReserveMs,
      });

    const resumeFull = Boolean(
      input.checkpoint &&
        directTransaction &&
        dateWindow &&
        input.checkpoint.state.stage === 'full' &&
        input.checkpoint.state.fingerprint ===
          primarySavingsIdentityCheckpointFingerprint({
            stage: 'full',
            window: null,
            reservation: expected,
            direct: directTransaction,
            actual,
            walletId: wallet.id,
            scope: input.checkpointScope,
          })
    );
    if (dateWindow && !resumeFull) {
      const located = await scan(dateWindow, 'date-window');
      if (located.status === 'matched') {
        await resetCheckpoint();
        return schemas.evidence.parse({
          environment: 'production',
          wallet,
          transaction: located.transaction,
        });
      }
      if (located.status === 'incomplete') return null;
      if (located.status === 'invalid') {
        await resetCheckpoint();
        return null;
      }
      if (!(await resetCheckpoint())) return null;
    }
    const scanned = await scan(null, 'full');
    if (scanned.status === 'matched') {
      await resetCheckpoint();
      return schemas.evidence.parse({
        environment: 'production',
        wallet,
        transaction: scanned.transaction,
      });
    }
    if (scanned.status === 'not-found' || scanned.status === 'invalid')
      await resetCheckpoint();
    return null;
  } catch {
    return null;
  }
}
