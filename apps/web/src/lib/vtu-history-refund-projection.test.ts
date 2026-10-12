import { describe, expect, it } from 'vitest';
import { projectHistoryRefundFields } from './vtu-history-refund-projection';

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
        status: 'failed',
      })
    ).toEqual({ refund_pending: false, refunded_to_wallet: 1000 });
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
        status: 'failed',
      })
    ).toEqual({ refund_pending: false, refunded_to_wallet: 1000 });
  });

  it('flags failed debited rows with no issued refund as pending', () => {
    expect(
      projectHistoryRefundFields({
        metadata: {
          walletDebited: true,
          paymentSplit: { wallet: 1000, card: 0 },
        },
        status: 'failed',
      })
    ).toEqual({ refund_pending: true, refunded_to_wallet: null });
  });

  it('returns null when nothing was restored', () => {
    // Issued but zero total (never-debited race with no card leg):
    // null keeps the view on generic copy instead of "₦0 refunded".
    expect(
      projectHistoryRefundFields({
        metadata: { refundIssued: true, refundAmount: 0 },
        status: 'failed',
      })
    ).toEqual({ refund_pending: false, refunded_to_wallet: null });
  });

  it('never flags non-failed rows as pending', () => {
    expect(
      projectHistoryRefundFields({
        metadata: { walletDebited: true },
        status: 'successful',
      })
    ).toEqual({ refund_pending: false, refunded_to_wallet: null });
    expect(
      projectHistoryRefundFields({ metadata: null, status: 'processing' })
    ).toEqual({ refund_pending: false, refunded_to_wallet: null });
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
        status: 'failed',
      })
    ).toEqual({ refund_pending: false, refunded_to_wallet: null });
  });
});
