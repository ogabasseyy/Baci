import { describe, expect, it } from 'vitest';
import { LocalAirportDeliveryFeeMismatchError } from './local-airport-delivery-fee-mismatch-error';

describe('LocalAirportDeliveryFeeMismatchError', () => {
  it('preserves both fee values and the bad-request contract', () => {
    const error = new LocalAirportDeliveryFeeMismatchError(25_000, 35_000);

    expect(error).toMatchObject({
      message: 'Shipping fee does not match the selected local airport fee',
      name: 'LocalAirportDeliveryFeeMismatchError',
      clientShippingFee: 25_000,
      serverShippingFee: 35_000,
      code: 'SHIPPING_FEE_MISMATCH',
      status: 400,
    });
  });
});
