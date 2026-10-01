import { describe, expect, it } from 'vitest';
import { toCreditOrderCustomerName } from './to-credit-order-customer-name';

describe('toCreditOrderCustomerName', () => {
  it('splits a full customer name', () => {
    expect(toCreditOrderCustomerName('Ada Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('supplies safe fallbacks for a missing name', () => {
    expect(toCreditOrderCustomerName(null)).toEqual({
      firstName: 'Customer',
      lastName: 'User',
    });
  });
});
