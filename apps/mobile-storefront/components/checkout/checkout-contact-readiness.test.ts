import { isCheckoutContactComplete } from './checkout-contact-readiness';

describe('isCheckoutContactComplete', () => {
  it('accepts complete contact details', () => {
    expect(
      isCheckoutContactComplete({
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+2349169449282',
      })
    ).toBe(true);
  });

  it('rejects missing or invalid contact details', () => {
    expect(
      isCheckoutContactComplete({
        email: 'not-an-email',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+2349169449282',
      })
    ).toBe(false);
    expect(
      isCheckoutContactComplete({
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      })
    ).toBe(false);
  });
});
