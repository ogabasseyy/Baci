import { describe, expect, it } from 'vitest';
import { bookWalletOrCustomerCheckout } from './book-wallet-or-customer-checkout';

describe('bookWalletFundedOrderShipment', () => {
  it('exports the wallet-funded booking entrypoint', () => {
    expect(typeof bookWalletOrCustomerCheckout).toBe('function');
  });
});
