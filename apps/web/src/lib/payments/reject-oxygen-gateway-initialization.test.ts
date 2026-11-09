import { describe, expect, it } from 'vitest';
import { rejectOxygenGatewayInitialization } from './reject-oxygen-gateway-initialization';

describe('rejectOxygenGatewayInitialization', () => {
  it('rejects direct gateway initialization for an Oxygen order', () => {
    expect(rejectOxygenGatewayInitialization('oxygen')).toEqual({
      code: 'OXYGEN_PAYMENT_IN_PROGRESS',
      message:
        'This order is using Oxygen. Continue your existing payment application.',
      status: 409,
    });
  });

  it.each([
    'paystack',
    'korapay',
    null,
    undefined,
  ])('does not reject another payment method: %s', (paymentMethod) => {
    expect(rejectOxygenGatewayInitialization(paymentMethod)).toBeNull();
  });
});
