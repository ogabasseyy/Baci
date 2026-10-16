import { describe, expect, it } from 'vitest';
import { projectHistoryRefundFields } from './vtu-history-refund-projection';

const CHECKOUT_ROW = {
  amount: 1000,
  customer_id: 'customer-1',
  id: 'vtu-1',
  source: 'checkout',
};

describe('projectHistoryRefundFields', () => {
  it('totals the reversed wallet leg plus the card leg', () => {
    // Hybrid: wallet leg reversed in full, card leg refunded via RPC.
    expect(
      projectHistoryRefundFields({
        metadata: {
          walletDebited: true,
          refundIssued: true,
          refundAmount: 700,
          paymentSplit: { wallet: 300, card: 700 },
        },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: 1000,
    });
  });

  it('reports the full restoration for wallet-only failures', () => {
    // The persisted refundAmount is the card leg (0); the wallet leg
    // carries the restoration — without the sum the view would claim
    // "₦0 was refunded" for ₦1,000 restored.
    expect(
      projectHistoryRefundFields({
        metadata: {
          walletDebited: true,
          refundIssued: true,
          refundAmount: 0,
          paymentSplit: { wallet: 1000, card: 0 },
        },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: 1000,
    });
  });

  it('flags failed debited rows with no issued refund as pending', () => {
    expect(
      projectHistoryRefundFields({
        metadata: {
          walletDebited: true,
          paymentSplit: { wallet: 1000, card: 0 },
        },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: true,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });

  it('keeps card-only failures pending until refundCardOnly lands', () => {
    // Legacy card-only rows have no split and no walletDebited marker,
    // but refundCardOnly still owes the full amount: an explicit false
    // here would read as refund proof and stop the pollers early.
    expect(
      projectHistoryRefundFields({
        metadata: {},
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: true,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
    // Wallet-race split rows without the debit marker: the card leg
    // is still owed until the race refund issues.
    expect(
      projectHistoryRefundFields({
        metadata: { paymentSplit: { wallet: 300, card: 700 } },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: true,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });

  it('clears pending for no-evidence skips: terminally failed, not owed', () => {
    // A skipped row was deliberately never credited (no collection
    // evidence) — keeping it pending would spin pollers forever on
    // a refund that will never arrive.
    expect(
      projectHistoryRefundFields({
        metadata: { refundSkipped: 'no_collection_evidence' },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: true,
      refunded_to_wallet: null,
    });
  });

  it('clears pending for wallet-race no-charge skips', () => {
    // The race arm charged nothing, so no refund RPC ran: skipped,
    // not pending, and never reported as refunded (R116 P2).
    expect(
      projectHistoryRefundFields({
        metadata: {
          paymentSplit: { card: 0, wallet: 1000 },
          refundSkipped: 'no_charge',
        },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: true,
      refunded_to_wallet: null,
    });
  });

  it('never flags rows that require no refund as pending', () => {
    const metadata = {};
    // Non-checkout sources never run refund handling.
    expect(
      projectHistoryRefundFields({
        metadata,
        row: { ...CHECKOUT_ROW, source: 'admin' },
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
    // Zero amounts and missing customers are refund-guard rejects.
    expect(
      projectHistoryRefundFields({
        metadata,
        row: { ...CHECKOUT_ROW, amount: 0 },
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
    expect(
      projectHistoryRefundFields({
        metadata,
        row: { ...CHECKOUT_ROW, customer_id: null },
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
    // PostgREST numerics arrive as strings — still a real amount.
    expect(
      projectHistoryRefundFields({
        metadata,
        row: { ...CHECKOUT_ROW, amount: '1000' },
        status: 'failed',
      })
    ).toEqual({
      refund_pending: true,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });

  it('returns null when nothing was restored', () => {
    // Issued but zero total (never-debited race with no card leg):
    // null keeps the view on generic copy instead of "₦0 refunded".
    expect(
      projectHistoryRefundFields({
        metadata: { refundIssued: true, refundAmount: 0 },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });

  it('never flags non-failed rows as pending', () => {
    expect(
      projectHistoryRefundFields({
        metadata: { walletDebited: true },
        row: CHECKOUT_ROW,
        status: 'successful',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
    expect(
      projectHistoryRefundFields({
        metadata: null,
        row: CHECKOUT_ROW,
        status: 'processing',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });

  it('tolerates malformed metadata', () => {
    expect(
      projectHistoryRefundFields({
        metadata: {
          walletDebited: 'yes',
          refundIssued: true,
          refundAmount: 'lots',
          paymentSplit: { wallet: 'many' },
        },
        row: CHECKOUT_ROW,
        status: 'failed',
      })
    ).toEqual({
      refund_pending: false,
      refund_skipped: false,
      refunded_to_wallet: null,
    });
  });
});
