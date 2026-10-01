import { describe, expect, it } from 'vitest';
import { OrderQuoteDestinationMismatchError } from './order-quote-destination-errors';

describe('OrderQuoteDestinationMismatchError', () => {
  it('uses the destination-mismatch defaults', () => {
    const error = new OrderQuoteDestinationMismatchError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('OrderQuoteDestinationMismatchError');
    expect(error.message).toBe(
      'The saved shipping quote no longer matches this delivery address. Please get a new quote before checkout.'
    );
    expect(error.code).toBe('INTERNATIONAL_QUOTE_DESTINATION_MISMATCH');
    expect(error.status).toBe(400);
  });

  it('preserves custom message, code, and status', () => {
    const error = new OrderQuoteDestinationMismatchError(
      'Custom mismatch',
      'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      409
    );

    expect(error.message).toBe('Custom mismatch');
    expect(error.code).toBe('INTERNATIONAL_QUOTE_ORDER_MISMATCH');
    expect(error.status).toBe(409);
  });
});
