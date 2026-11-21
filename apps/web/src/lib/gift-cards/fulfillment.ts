import type { PetrockOrderStatus } from '../imei-providers/petrock/petrock.types';

export function resolveGiftCardFulfillment(
  expected: { orderId: string; reference: string },
  order: {
    orderUuid: string;
    referenceId?: string;
    status: PetrockOrderStatus;
    replay: string;
  },
  decodeVoucher?: (replay: string) => string | null
):
  | { status: 'pending' | 'rejected' | 'review' }
  | { status: 'fulfilled'; voucher: string } {
  if (
    order.orderUuid !== expected.orderId ||
    order.referenceId !== expected.reference
  ) {
    return { status: 'review' };
  }

  if (order.status === 'reject') return { status: 'rejected' };
  if (order.status !== 'success') return { status: 'pending' };

  // A success receipt establishes order state, but cannot validate a voucher format.
  if (!decodeVoucher || !order.replay.trim()) return { status: 'review' };
  try {
    const voucher = decodeVoucher(order.replay);
    if (voucher?.trim()) return { status: 'fulfilled', voucher };
  } catch {
    // A malformed supplier result needs review, with no raw content in logs.
  }
  return { status: 'review' };
}
