import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fulfillPendingVtuTransactionMock, overlayReplayAttributesMock } =
  vi.hoisted(() => ({
    fulfillPendingVtuTransactionMock: vi.fn(),
    overlayReplayAttributesMock: vi.fn(),
  }));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: fulfillPendingVtuTransactionMock,
}));

vi.mock('@/lib/vtu-replay-attribute-overlay', () => ({
  overlayReplayAttributes: overlayReplayAttributesMock,
}));

import { reconcileProcessingVtuTransactions } from '@/lib/vtu-processing-reconciliation';

function createProcessingQuery(response: {
  count?: null | number;
  data?: unknown;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(async () => ({
      count: response.count ?? null,
      data: response.data ?? null,
      error: response.error ?? null,
    })),
    lte: vi.fn(() => query),
    or: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => ({
      count: response.count ?? null,
      data: response.data ?? null,
      error: response.error ?? null,
    })),
    select: vi.fn(() => query),
  };
  return query;
}

function createSupabase({
  countQuery = createProcessingQuery({ count: 0 }),
  dataQuery,
}: {
  countQuery?: ReturnType<typeof createProcessingQuery>;
  dataQuery: ReturnType<typeof createProcessingQuery>;
}) {
  return {
    from: vi
      .fn()
      .mockReturnValueOnce(countQuery)
      .mockReturnValueOnce(dataQuery),
  };
}

describe('reconcileProcessingVtuTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overlayReplayAttributesMock.mockResolvedValue({
      updated: false,
      refreshed: false,
    });
  });

  it('reconciles recent processing bill transactions and summarizes outcomes', async () => {
    const countQuery = createProcessingQuery({
      count: 2,
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-success' }, { id: 'tx-processing' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock
      .mockResolvedValueOnce({ status: 'successful' })
      .mockResolvedValueOnce({ status: 'processing' });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 2,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(countQuery.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(countQuery.or).toHaveBeenCalledWith(
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null,metadata->>refundSkipped.is.null),and(status.eq.successful,or(and(merchant_commission.gt.0,or(metadata->>merchantWalletCredited.neq.true,metadata->>merchantWalletCredited.is.null)),and(customer_cashback.gt.0,customer_id.not.is.null,or(metadata->>customerWalletCredited.neq.true,metadata->>customerWalletCredited.is.null)),and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null)),and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null),and(customer_id.not.is.null,or(and(metadata->>customerReceiptEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),metadata->>customerTokenEmailNotificationSent.eq.false,and(metadata->>customerEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerReceiptEmailNotificationSent.is.null,or(metadata->>customerReceiptEmailNotificationAttempted.eq.false,and(metadata->>customerReceiptEmailNotificationAttempted.eq.true,or(metadata->>customerReceiptEmailNotificationAttemptedAt.is.null,metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerTokenEmailNotificationSent.is.null,or(metadata->>customerTokenEmailNotificationAttempted.eq.false,and(metadata->>customerTokenEmailNotificationAttempted.eq.true,or(metadata->>customerTokenEmailNotificationAttemptedAt.is.null,metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))))))'
    );
    expect(countQuery.in).toHaveBeenCalledWith('type', [
      'airtime',
      'data',
      'electricity',
      'cable_tv',
      'betting',
    ]);
    expect(countQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-05-07T21:13:15.000Z'
    );
    expect(countQuery.limit).toHaveBeenCalledWith(1);
    expect(dataQuery.select).toHaveBeenCalledWith('id');
    expect(dataQuery.or).toHaveBeenCalledWith(
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null,metadata->>refundSkipped.is.null),and(status.eq.successful,or(and(merchant_commission.gt.0,or(metadata->>merchantWalletCredited.neq.true,metadata->>merchantWalletCredited.is.null)),and(customer_cashback.gt.0,customer_id.not.is.null,or(metadata->>customerWalletCredited.neq.true,metadata->>customerWalletCredited.is.null)),and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null)),and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null),and(customer_id.not.is.null,or(and(metadata->>customerReceiptEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),metadata->>customerTokenEmailNotificationSent.eq.false,and(metadata->>customerEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerReceiptEmailNotificationSent.is.null,or(metadata->>customerReceiptEmailNotificationAttempted.eq.false,and(metadata->>customerReceiptEmailNotificationAttempted.eq.true,or(metadata->>customerReceiptEmailNotificationAttemptedAt.is.null,metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerTokenEmailNotificationSent.is.null,or(metadata->>customerTokenEmailNotificationAttempted.eq.false,and(metadata->>customerTokenEmailNotificationAttempted.eq.true,or(metadata->>customerTokenEmailNotificationAttemptedAt.is.null,metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))))))'
    );
    expect(dataQuery.lte).toHaveBeenCalledWith(
      'created_at',
      '2026-05-07T21:13:15.000Z'
    );
    expect(dataQuery.order).toHaveBeenNthCalledWith(1, 'created_at', {
      ascending: true,
    });
    expect(dataQuery.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
    expect(dataQuery.range).toHaveBeenCalledWith(0, 1);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-success',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-processing',
    });
    // No client values on this path: the overlay runs in refresh-only
    // mode so a server-minted reference is fresh before each re-drive.
    expect(overlayReplayAttributesMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-success',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(overlayReplayAttributesMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-processing',
      customerPhone: undefined,
      validationReference: undefined,
    });
    expect(result).toEqual({
      checked: 2,
      errored: 0,
      errors: [],
      failed: 0,
      processing: 1,
      successful: 1,
    });
  });

  it('selects marked pending rows so interrupted debits re-vend', async () => {
    // Monnify timeouts (no vendReference: requery is PENDING forever)
    // and pre-vend interruptions (no reference at all: the reconcile
    // claim declines them) restore to marked pending so the claim →
    // re-vend flow resolves them. Plain pending rows stay excluded
    // (mapping-less orphans); failed+refund-required+unissued rows
    // (including marker-less card-only) are selected so the failed
    // branch confirms the refund even when the customer closes the
    // client instead of retrying.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-retry' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const expectedFilter =
      'status.eq.processing,and(status.eq.pending,or(metadata->>monnifyTransientVendError.not.is.null,metadata->>preVendInterruptedAt.not.is.null)),and(status.eq.failed,source.eq.checkout,amount.gt.0,customer_id.not.is.null,metadata->>refundIssued.is.null,metadata->>refundSkipped.is.null),and(status.eq.successful,or(and(merchant_commission.gt.0,or(metadata->>merchantWalletCredited.neq.true,metadata->>merchantWalletCredited.is.null)),and(customer_cashback.gt.0,customer_id.not.is.null,or(metadata->>customerWalletCredited.neq.true,metadata->>customerWalletCredited.is.null)),and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null)),and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null),and(customer_id.not.is.null,or(and(metadata->>customerReceiptEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),metadata->>customerTokenEmailNotificationSent.eq.false,and(metadata->>customerEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerReceiptEmailNotificationSent.is.null,or(metadata->>customerReceiptEmailNotificationAttempted.eq.false,and(metadata->>customerReceiptEmailNotificationAttempted.eq.true,or(metadata->>customerReceiptEmailNotificationAttemptedAt.is.null,metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerTokenEmailNotificationSent.is.null,or(metadata->>customerTokenEmailNotificationAttempted.eq.false,and(metadata->>customerTokenEmailNotificationAttempted.eq.true,or(metadata->>customerTokenEmailNotificationAttemptedAt.is.null,metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))))))';
    expect(countQuery.or).toHaveBeenCalledWith(expectedFilter);
    expect(dataQuery.or).toHaveBeenCalledWith(expectedFilter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-retry',
    });
    expect(result.successful).toBe(1);
  });

  it('selects successful rows with unsettled wallet credits for re-drive', async () => {
    // Codex R81 P1: a credit RPC failing after the vend lands leaves
    // the row successful with merchant/customerWalletCredited unset —
    // clients discard the key on success, so only the cron can retry
    // the missing commission/cashback. Fulfill routes successful rows
    // to the settle-only path (no re-vend; ledger guards skip landed
    // credits), so re-driving is safe.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-credits' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    expect(filter).toContain(
      'and(status.eq.successful,or(and(merchant_commission.gt.0,or(metadata->>merchantWalletCredited.neq.true,metadata->>merchantWalletCredited.is.null)),and(customer_cashback.gt.0,customer_id.not.is.null,or(metadata->>customerWalletCredited.neq.true,metadata->>customerWalletCredited.is.null)),and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null)),and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null),and(customer_id.not.is.null,or(and(metadata->>customerReceiptEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),metadata->>customerTokenEmailNotificationSent.eq.false,and(metadata->>customerEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerReceiptEmailNotificationSent.is.null,or(metadata->>customerReceiptEmailNotificationAttempted.eq.false,and(metadata->>customerReceiptEmailNotificationAttempted.eq.true,or(metadata->>customerReceiptEmailNotificationAttemptedAt.is.null,metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),and(metadata->>customerTokenEmailNotificationSent.is.null,or(metadata->>customerTokenEmailNotificationAttempted.eq.false,and(metadata->>customerTokenEmailNotificationAttempted.eq.true,or(metadata->>customerTokenEmailNotificationAttemptedAt.is.null,metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))))))'
    );
    // Codex R82 P1: `->>` extracts TEXT, and `IS [NOT] TRUE` on text
    // is a Postgres type error that 500s the cron queries — boolean
    // intent on extracted flags must stay `neq.true` + `is.null`.
    // (`IS [NOT] NULL` is type-agnostic, so null arms are exempt.)
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-credits',
    });
    expect(result.successful).toBe(1);
  });

  it('selects successful airtime rows with unawarded loyalty points for re-drive', async () => {
    // Codex R85 P2: the award helper logs a transient
    // award_vtu_airtime_loyalty_points failure and fulfillment still
    // returns success, so clients discard the key — with both wallet
    // credits landed, no existing arm reselects the row and the
    // points are never retried. The loyalty arm reselects eligible
    // successes (airtime + linked customer + points-earning cashback
    // without the marker); the RPC is idempotent (already_awarded),
    // and resolveSuccessful re-runs the award on the settle-only
    // path, so re-driving is safe.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-loyalty' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    expect(filter).toContain(
      'and(type.eq.airtime,customer_id.not.is.null,customer_cashback.gte.3,or(metadata->>loyaltyPointsAwarded.neq.true,metadata->>loyaltyPointsAwarded.is.null))'
    );
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-loyalty',
    });
    expect(result.successful).toBe(1);
  });

  it('selects successful rows with a failed receipt email for re-drive', async () => {
    // Codex R86 P2: a ZeptoMail failure after a successful vend is
    // recorded (sent=false, claim cleared) but fulfillment still
    // returns success, so clients discard the key — with wallet
    // credits and loyalty settled, no existing arm reselects the row
    // and the receipt/token-ready email is never retried. The email
    // arm reselects successes with a RECORDED failure (eq.false, so
    // never-attempted rows stay excluded and cannot churn); the
    // claim RPC serializes concurrent re-drives, and
    // resolveSuccessful re-runs the notifier on the settle-only
    // path, so re-driving is safe.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-email' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    expect(filter).toContain(
      'and(customer_id.not.is.null,or(and(metadata->>customerReceiptEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),metadata->>customerTokenEmailNotificationSent.eq.false,and(metadata->>customerEmailNotificationSent.eq.false,or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)),'
    );
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-email',
    });
    expect(result.successful).toBe(1);
  });

  it('selects successful rows with a stuck email claim for re-drive', async () => {
    // Codex R89 P2: a crash between the email-claim RPC and the sent
    // write leaves Attempted=true with the sent key unset — the R86
    // recorded-failure arm (eq.false) never matches a missing key, so
    // without a stuck-claim disjunct the row is never retried. Stuck =
    // sent key absent AND (claim cleared OR timestamp missing/older
    // than the 15-minute lease). The cutoff derives from the
    // invocation now (21:14 → 20:59), so a live sender's fresh lease
    // is never selected.
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-stuck' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    expect(filter).toContain(
      'and(metadata->>customerReceiptEmailNotificationSent.is.null,or(metadata->>customerReceiptEmailNotificationAttempted.eq.false,and(metadata->>customerReceiptEmailNotificationAttempted.eq.true,or(metadata->>customerReceiptEmailNotificationAttemptedAt.is.null,metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true))'
    );
    expect(filter).toContain(
      'and(metadata->>customerTokenEmailNotificationSent.is.null,or(metadata->>customerTokenEmailNotificationAttempted.eq.false,and(metadata->>customerTokenEmailNotificationAttempted.eq.true,or(metadata->>customerTokenEmailNotificationAttemptedAt.is.null,metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))'
    );
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-stuck',
    });
  });

  it('selects successful rows whose token arrived after the receipt email for re-drive', async () => {
    // Codex R90 P2: a bill row settling with no token sends the
    // receipt email while both token markers stay absent; the
    // history backfill later writes the PIN directly and never
    // notifies, and NULL markers match neither the recorded-failure
    // arm nor the stuck-claim arm — so the token-ready email never
    // fires. The token-backfill arm requires the receipt marker as
    // proof settle-notify ran and the customer is emailable (no
    // churn on email-less or pre-notify rows).
    const countQuery = createProcessingQuery({ count: 1 });
    const dataQuery = createProcessingQuery({ data: [{ id: 'tx-token' }] });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'successful',
    });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    expect(filter).toContain(
      'and(or(type.eq.electricity,type.eq.cable_tv,type.eq.betting),customer_id.not.is.null,metadata->>voucherPin.not.is.null,metadata->>customerReceiptEmailNotificationSent.eq.true,metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationAttempted.is.null)'
    );
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-token',
    });
  });

  it('retires receipt failures once the token email succeeds', async () => {
    // Codex R92 P2: a tokenless bill whose receipt fails, then gains
    // a PIN via backfill, switches notify to the token state — the
    // token sends but the receipt Sent=false is never cleared. The
    // receipt/legacy recorded-failure disjuncts and the stuck-receipt
    // disjunct therefore carry a token-unsent gate (only token=true
    // retires); the token-failure disjuncts stay ungated — a failed
    // token is itself work.
    const countQuery = createProcessingQuery({ count: 0 });
    const dataQuery = createProcessingQuery({ data: [] });
    const supabase = createSupabase({ countQuery, dataQuery });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 1,
      now: new Date('2026-05-07T21:14:00.000Z'),
      supabase: supabase as never,
    });

    const orCalls = dataQuery.or.mock.calls as unknown as [string][];
    const filter = orCalls[0]?.[0] as string;
    const gate =
      'or(metadata->>customerTokenEmailNotificationSent.is.null,metadata->>customerTokenEmailNotificationSent.neq.true)';
    expect(filter).toContain(
      `and(metadata->>customerReceiptEmailNotificationSent.eq.false,${gate})`
    );
    expect(filter).toContain(
      `and(metadata->>customerEmailNotificationSent.eq.false,${gate})`
    );
    expect(filter).toContain(
      `metadata->>customerReceiptEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))),${gate})`
    );
    // Token failures ungated: bare eq.false disjunct, and the stuck
    // token arm closes without a gate.
    expect(filter).toContain(
      ',metadata->>customerTokenEmailNotificationSent.eq.false,'
    );
    expect(filter).toContain(
      'metadata->>customerTokenEmailNotificationAttemptedAt.lt.2026-05-07T20:59:00.000Z))))'
    );
    expect(filter).not.toMatch(/->>[a-zA-Z0-9_]+(\.not)?\.is\.(true|false)/);
    expect(countQuery.or).toHaveBeenCalledWith(filter);
  });

  it('rotates reconciliation pages through the processing backlog', async () => {
    const countQuery = createProcessingQuery({
      count: 75,
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-middle' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValueOnce({
      status: 'processing',
    });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 25,
      now: new Date('1970-01-01T00:05:00.000Z'),
      supabase: supabase as never,
    });

    expect(dataQuery.range).toHaveBeenCalledWith(25, 49);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledWith({
      supabase,
      transactionId: 'tx-middle',
    });
  });

  it('continues reconciling after one transaction throws', async () => {
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-error' }, { id: 'tx-failed' }],
    });
    const supabase = createSupabase({
      countQuery: createProcessingQuery({ count: 2 }),
      dataQuery,
    });
    fulfillPendingVtuTransactionMock
      .mockRejectedValueOnce(new Error('Kuda TSQ unavailable'))
      .mockResolvedValueOnce({ status: 'failed' });

    const result = await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      // Window 0: rotation start 0, so the once-mocks pair with the
      // fetched order deterministically.
      now: new Date(0),
      supabase: supabase as never,
    });

    expect(result).toEqual({
      checked: 2,
      errored: 1,
      errors: [
        {
          message: 'Kuda TSQ unavailable',
          transactionId: 'tx-error',
        },
      ],
      failed: 1,
      processing: 0,
      successful: 0,
    });
  });

  it('throws when processing transaction lookup fails', async () => {
    const dataQuery = createProcessingQuery({
      data: null,
      error: { message: 'database timeout' },
    });
    const supabase = createSupabase({
      countQuery: createProcessingQuery({ count: 1 }),
      dataQuery,
    });

    await expect(
      reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 3_600_000,
        supabase: supabase as never,
      })
    ).rejects.toThrow(
      'Failed to fetch processing VTU transactions: database timeout'
    );
  });

  it('throws when processing transaction count fails', async () => {
    const countQuery = createProcessingQuery({
      error: { message: 'count timeout' },
    });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-skipped' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });

    await expect(
      reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 3_600_000,
        supabase: supabase as never,
      })
    ).rejects.toThrow(
      'Failed to count processing VTU transactions: count timeout'
    );
    expect(dataQuery.select).not.toHaveBeenCalled();
  });

  it('starts nothing when the deadline is already exhausted', async () => {
    const countQuery = createProcessingQuery({ count: 2 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-1' }, { id: 'tx-2' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() - 1_000,
        limit: 2,
        supabase: supabase as never,
      });

      expect(result).toMatchObject({ checked: 0 });
      expect(fulfillPendingVtuTransactionMock).not.toHaveBeenCalled();
      expect(overlayReplayAttributesMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU reconciliation stopping early: route deadline approaching:',
        expect.objectContaining({ checked: 0, deferred: 2 })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stops mid-batch once remaining budget drops below one worst-case row', async () => {
    // 300s deadline, 120s single-row reserve: rows cost 100s each, so
    // rows 1-2 run (t=0/100, remaining 300/200) and row 3 stops
    // (t=200, remaining 100 < 120). Leftovers ride the next rotation
    // instead of dying mid-row at maxDuration (Codex R43 rnTRm).
    vi.useFakeTimers();
    const countQuery = createProcessingQuery({ count: 3 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-1' }, { id: 'tx-2' }, { id: 'tx-3' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
      return { status: 'processing' };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 300_000,
        limit: 3,
        supabase: supabase as never,
      });

      expect(result).toMatchObject({ checked: 2, processing: 2 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU reconciliation stopping early: route deadline approaching:',
        expect.objectContaining({ checked: 2, deferred: 1 })
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('rotates the intra-page start by the window number', async () => {
    // Window 2 of 3 rows: start index 2, visiting c3, c1, c2.
    const countQuery = createProcessingQuery({ count: 3 });
    const dataQuery = createProcessingQuery({
      data: [{ id: 'tx-c1' }, { id: 'tx-c2' }, { id: 'tx-c3' }],
    });
    const supabase = createSupabase({ countQuery, dataQuery });
    fulfillPendingVtuTransactionMock.mockResolvedValue({
      status: 'processing',
    });

    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      now: new Date(2 * 5 * 60 * 1000),
      supabase: supabase as never,
    });

    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase,
      transactionId: 'tx-c3',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(2, {
      supabase,
      transactionId: 'tx-c1',
    });
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(3, {
      supabase,
      transactionId: 'tx-c2',
    });
  });

  it('defers a different tail when the deadline breaks consecutive windows', async () => {
    // One row per pass (100s each, 219s budget minus the 120s
    // reserve): window 3 starts at c1, window 4 at c2, so a slow head
    // row cannot starve the same tail on every visit.
    vi.useFakeTimers();
    fulfillPendingVtuTransactionMock.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(100_000);
      return { status: 'processing' };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buildSupabase = () =>
      createSupabase({
        countQuery: createProcessingQuery({ count: 3 }),
        dataQuery: createProcessingQuery({
          data: [{ id: 'tx-c1' }, { id: 'tx-c2' }, { id: 'tx-c3' }],
        }),
      });

    try {
      const first = buildSupabase();
      const firstResult = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 219_000,
        now: new Date(3 * 5 * 60 * 1000),
        supabase: first as never,
      });
      expect(firstResult).toMatchObject({ checked: 1 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenLastCalledWith({
        supabase: first,
        transactionId: 'tx-c1',
      });

      fulfillPendingVtuTransactionMock.mockClear();
      const second = buildSupabase();
      const secondResult = await reconcileProcessingVtuTransactions({
        deadlineMs: Date.now() + 219_000,
        now: new Date(4 * 5 * 60 * 1000),
        supabase: second as never,
      });
      expect(secondResult).toMatchObject({ checked: 1 });
      expect(fulfillPendingVtuTransactionMock).toHaveBeenLastCalledWith({
        supabase: second,
        transactionId: 'tx-c2',
      });
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('advances the start by one on consecutive visits to the same page', async () => {
    // Six rows in 2-row pages (3 pages): windows 1 and 4 both select
    // page 1 (offset 2), and the visit numbers 0 and 1 start at c1
    // then c2. A window-derived start would jump by pageCount (3)
    // per revisit instead, stranding most positions forever.
    fulfillPendingVtuTransactionMock.mockResolvedValue({
      status: 'processing',
    });
    const buildSupabase = () => {
      const dataQuery = createProcessingQuery({
        data: [{ id: 'tx-c1' }, { id: 'tx-c2' }],
      });
      return {
        dataQuery,
        supabase: createSupabase({
          countQuery: createProcessingQuery({ count: 6 }),
          dataQuery,
        }),
      };
    };

    const first = buildSupabase();
    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 2,
      now: new Date(1 * 5 * 60 * 1000),
      supabase: first.supabase as never,
    });
    expect(first.dataQuery.range).toHaveBeenCalledWith(2, 3);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase: first.supabase,
      transactionId: 'tx-c1',
    });

    fulfillPendingVtuTransactionMock.mockClear();
    const second = buildSupabase();
    await reconcileProcessingVtuTransactions({
      deadlineMs: Date.now() + 3_600_000,
      limit: 2,
      now: new Date(4 * 5 * 60 * 1000),
      supabase: second.supabase as never,
    });
    expect(second.dataQuery.range).toHaveBeenCalledWith(2, 3);
    expect(fulfillPendingVtuTransactionMock).toHaveBeenNthCalledWith(1, {
      supabase: second.supabase,
      transactionId: 'tx-c2',
    });
  });
});
