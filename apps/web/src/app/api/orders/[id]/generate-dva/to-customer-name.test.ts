import { describe, expect, it } from 'vitest';
import { toCustomerName } from './to-customer-name';

describe('toCustomerName', () => {
  it('splits a customer name for Paystack', () => {
    expect(toCustomerName('Ada Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('provides safe defaults for an empty name', () => {
    expect(toCustomerName(null)).toEqual({
      firstName: 'Customer',
      lastName: 'User',
    });
  });
});
