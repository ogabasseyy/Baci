import { describe, expect, it } from 'vitest';
import { OrderStatusUpdateError } from './order-status-update-error';

describe('OrderStatusUpdateError', () => {
  it('preserves the API error code and wallet snapshot', () => {
    const error = new OrderStatusUpdateError(
      'Insufficient merchant wallet balance.',
      'MERCHANT_WALLET_INSUFFICIENT',
      { availableBalance: 1000, chargedAmount: 4500, shortfall: 3500 }
    );

    expect(error).toMatchObject({
      name: 'OrderStatusUpdateError',
      code: 'MERCHANT_WALLET_INSUFFICIENT',
      details: { shortfall: 3500 },
    });
  });
});
