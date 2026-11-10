import { describe, expect, it } from 'vitest';
import { mapCancellationRpcError } from './map-cancellation-rpc-error';

describe('mapCancellationRpcError', () => {
  it.each([
    [
      'P0001',
      'payment_capture_in_flight',
      409,
      'PAYMENT_RECONCILIATION_REQUIRED',
    ],
    ['P0001', 'order_not_cancellable', 409, 'ORDER_NOT_CANCELLABLE'],
    ['P0002', 'order_not_found', 404, undefined],
    ['42501', 'order_cancel_forbidden', 403, undefined],
    ['42501', 'order_cancel_refund_forbidden', 403, 'CANCEL_REFUND_FORBIDDEN'],
    ['22023', 'invalid_refund_mode', 400, 'INVALID_REFUND_MODE'],
    ['XX000', 'boom', 500, undefined],
  ])('maps %s %s', (code, message, status, mapped) => {
    expect(mapCancellationRpcError({ code, message })).toMatchObject({
      code: mapped,
      status,
    });
  });

  it('does not turn an unrelated 22023 into a refund-option error', () => {
    expect(
      mapCancellationRpcError({ code: '22023', message: 'other' }).status
    ).toBe(500);
  });

  it('never leaks the database message', () => {
    expect(
      mapCancellationRpcError({ code: 'XX000', message: 'secret detail' }).error
    ).toBe('Failed to cancel order');
  });
});
