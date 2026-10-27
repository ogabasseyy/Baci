import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { primaryWalletSavingsIdentitySchemas as schemas } from '@/schemas/primary-wallet-savings-identity';
import { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { isExplicitUnsupportedSavingsDateFilterError } from './primary-wallet-savings-identity-date-filter-error';

type Reservation = {
  operationId: string;
  amountKobo: number;
  sourceWalletId: string;
  destinationWalletId: string;
  reference: string;
  businessId: string;
  providerCustomerId: string;
};
type DirectTransaction = z.infer<typeof schemas.singleTransaction>;
type ActualTransaction = z.infer<
  typeof prefundedCardTransferVerificationSchemas.rich
>['data'];
type CheckpointState = z.infer<typeof checkpointSchemas.state>;
type Checkpoint = {
  state: CheckpointState;
  save: (state: CheckpointState) => Promise<boolean>;
};
type Window = { startDate: string; endDate: string } | null;
type ScanResult =
  | { status: 'matched'; transaction: z.infer<typeof schemas.transaction> }
  | { status: 'not-found' | 'invalid' | 'unsupported' | 'incomplete' };

export function primarySavingsIdentityCheckpointFingerprint(input: {
  stage: 'date-window' | 'full';
  window: Window;
  reservation: Reservation;
  direct?: DirectTransaction;
  actual: ActualTransaction;
  walletId: string;
  scope?: { integrationId: string; environment: 'production' };
}) {
  const stableFields = [
    input.stage,
    input.window?.startDate ?? null,
    input.window?.endDate ?? null,
    input.reservation.operationId,
    input.reservation.businessId,
    input.reservation.providerCustomerId,
    input.reservation.sourceWalletId,
    input.reservation.destinationWalletId,
    input.reservation.amountKobo,
    input.reservation.reference,
    input.walletId,
    input.scope?.integrationId ?? null,
    input.scope?.environment ?? null,
    input.direct?.id ?? input.actual.id,
    input.direct?.customer_id ?? input.actual.customer_id,
    input.direct?.source_wallet ?? input.actual.source_wallet,
    input.direct?.destination_wallet ?? input.actual.destination_wallet,
    input.direct?.amount ?? input.actual.amount,
    input.direct?.reference ?? input.actual.reference,
    input.direct?.third_party_reference ?? input.actual.third_party_reference,
  ];
  return createHash('sha256')
    .update(JSON.stringify(stableFields))
    .digest('hex');
}

export async function scanPrimarySavingsIdentityList(input: {
  getData: (
    path: string,
    maxBytes: number,
    reserveAfterMs?: number
  ) => Promise<unknown>;
  reservation: Reservation;
  direct?: DirectTransaction;
  actual: ActualTransaction;
  walletId: string;
  scope?: { integrationId: string; environment: 'production' };
  stage: 'date-window' | 'full';
  window: Window;
  checkpoint?: Checkpoint;
  pageSize: number;
  maxPages: number;
  pageResponseBytes: number;
  fallbackReserveMs: number;
}): Promise<ScanResult> {
  const expectedFingerprint =
    primarySavingsIdentityCheckpointFingerprint(input);
  const saved = input.checkpoint?.state;
  const resume =
    saved?.stage === input.stage && saved.fingerprint === expectedFingerprint;
  if (input.checkpoint && !resume) {
    if (!(await input.checkpoint.save(checkpointSchemas.emptyState)))
      return { status: 'invalid' };
  }
  let cursor: string | null = resume ? saved.cursor : null;
  const initialCursor = cursor;
  const previousDigest = resume ? saved.pageDigest : null;
  const cursors = new Set<string>(cursor === null ? [] : [cursor]);
  const identifiers = new Set<string>();
  let transaction: z.infer<typeof schemas.transaction> | null = null;
  for (let pageNumber = 0; pageNumber < input.maxPages; pageNumber++) {
    const query = new URLSearchParams({
      wallet_id: input.walletId,
      limit: String(input.pageSize),
      collapse_batch: '0',
    });
    if (input.window) {
      query.set('start_date', input.window.startDate);
      query.set('end_date', input.window.endDate);
    }
    if (cursor !== null) query.set('cursor', cursor);
    let data: unknown;
    try {
      data = await input.getData(
        `/api/v1/transaction?${query.toString()}`,
        input.pageResponseBytes,
        input.window ? input.fallbackReserveMs : 0
      );
    } catch (error) {
      const transient =
        error instanceof Error &&
        [
          'PROVIDER_TIMEOUT',
          'PROVIDER_UNAVAILABLE',
          'SAVINGS_IDENTITY_DEADLINE',
        ].includes(error.message);
      if (
        input.window &&
        (transient || isExplicitUnsupportedSavingsDateFilterError(error))
      )
        return { status: 'unsupported' };
      return transient ? { status: 'incomplete' } : { status: 'invalid' };
    }
    const parsed = schemas.page.safeParse(data);
    if (!parsed.success) return { status: 'invalid' };
    const page = parsed.data;
    const digest = createHash('sha256')
      .update(JSON.stringify([page.edges.map(({ id }) => id), page.pageInfo]))
      .digest('hex');
    if (
      (page.edges.length === 0 &&
        (page.pageInfo.hasNextPage || pageNumber > 0)) ||
      (pageNumber === 0 &&
        initialCursor !== null &&
        (digest === previousDigest ||
          page.pageInfo.endCursor === initialCursor))
    )
      return { status: 'invalid' };
    let matched: z.infer<typeof schemas.transaction> | null = null;
    for (const candidate of page.edges) {
      if (identifiers.has(candidate.id)) return { status: 'invalid' };
      identifiers.add(candidate.id);
      if (candidate.id !== input.actual.id) continue;
      if (transaction || matched) return { status: 'invalid' };
      matched = schemas.transaction.safeParse(candidate).data ?? null;
      if (
        !matched ||
        matched.business_id !== input.reservation.businessId ||
        matched.wallet_id !== input.walletId ||
        matched.api_customer_id !== input.reservation.providerCustomerId ||
        matched.amount !== -input.reservation.amountKobo ||
        matched.third_party_reference !== input.reservation.reference ||
        matched.provider_reference !== input.actual.reference
      )
        return { status: 'invalid' };
    }
    const nextCursor = page.pageInfo.endCursor;
    if (nextCursor !== null && cursors.has(nextCursor))
      return { status: 'invalid' };
    if (nextCursor !== null) cursors.add(nextCursor);
    if (input.checkpoint && page.pageInfo.hasNextPage && nextCursor !== null) {
      const savedSuccessfully = await input.checkpoint.save({
        stage: input.stage,
        fingerprint: expectedFingerprint,
        cursor: nextCursor,
        pageDigest: digest,
      });
      if (!savedSuccessfully) return { status: 'invalid' };
    }
    cursor = nextCursor;
    if (matched) {
      if (page.pageInfo.hasNextPage)
        return { status: 'matched', transaction: matched };
      transaction = matched;
    }
    if (!page.pageInfo.hasNextPage)
      return transaction === null
        ? { status: 'not-found' }
        : { status: 'matched', transaction };
  }
  return { status: 'incomplete' };
}
