import type { Mock } from 'vitest';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';

export const initiationOrder = {
  currency: 'NGN',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_number: 'B-1',
};

export const initiationTransaction = {
  amount: 12.5,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'PSK-1',
  id: 'tx-1',
} as GatewayPaymentTransaction;

export function mockAcceptedRefund(
  initiateMock: Mock,
  overrides: Record<string, unknown> = {}
) {
  initiateMock.mockResolvedValue({
    data: {
      id: 101,
      status: 'queued',
      transaction: { id: 55, reference: 'PSK-1' },
      ...overrides,
    },
    success: true,
  });
}
