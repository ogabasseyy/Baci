import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  `${process.cwd()}/src/app/api/orders/[id]/route.ts`,
  'utf8'
);
describe('order PATCH merchant wallet booking', () => {
  it('uses the extracted claimed-order wallet/checkout booking helper', () => {
    expect(source).toContain('runClaimedOrderWalletOrCheckoutBooking');
    expect(source).toContain('existingOrder.shipping_funding_source');
    expect(source).not.toContain('bookWalletOrCustomerCheckout(');
  });

  it('passes the requested payment status into prepaid GIGL booking', () => {
    expect(source).toContain(
      'paymentStatus: payment_status ?? existingOrder.payment_status'
    );
  });

  it('keeps funded-checkout address lock and omits revoked retained columns', () => {
    expect(source).toContain('isFundedCheckoutGiglAddressLocked');
    expect(source).toContain('settled retention only');
    expect(source).not.toContain(
      'existingOrder.shipping_platform_retained_amount'
    );
    expect(source).not.toMatch(
      /\.select\(\s*'[^']*shipping_platform_retained_amount[^']*'\s*\)/
    );
  });
});
