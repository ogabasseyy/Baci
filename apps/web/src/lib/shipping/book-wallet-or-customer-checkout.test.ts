import { describe, expect, it } from 'vitest';
import { bookWalletOrCustomerCheckout } from './book-wallet-or-customer-checkout';

describe('bookWalletOrCustomerCheckout', () => {
  it('exports the checkout-or-wallet booking dispatcher', () => {
    expect(typeof bookWalletOrCustomerCheckout).toBe('function');
  });
});
