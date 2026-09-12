import { RedvaultCheckoutSchema } from './redvault-checkout';

const checkout = {
  order: {
    id: '44444444-4444-4444-8444-444444444444',
    total: 117.5,
    currency: 'NGN',
    tracking_token: null,
    payment_method: 'uba_redvault',
    payment_status: 'unpaid',
  },
  redvault: {
    status: 'pending',
    quote: {
      product_subtotal_kobo: 11000,
      eligible_subtotal_kobo: 10000,
      ineligible_subtotal_kobo: 1000,
      discount_kobo: 500,
      assurance_fee_kobo: 0,
      tax_kobo: 750,
      shipping_kobo: 500,
      gift_wrapping_kobo: 0,
      payable_kobo: 11750,
      mixed_basket: true,
    },
  },
};

describe('persisted REDVAULT contract', () => {
  it('preserves every snake_case field', () => {
    expect(RedvaultCheckoutSchema.parse(checkout)).toEqual(checkout);
  });
  it.each(
    Object.keys(checkout.redvault.quote)
  )('rejects missing %s instead of falling back', (field) => {
    const quote: Record<string, unknown> = { ...checkout.redvault.quote };
    delete quote[field];
    expect(
      RedvaultCheckoutSchema.safeParse({
        ...checkout,
        redvault: { status: 'pending', quote },
      }).success
    ).toBe(false);
  });
  it('rejects an inconsistent server total', () => {
    expect(
      RedvaultCheckoutSchema.safeParse({
        ...checkout,
        order: { ...checkout.order, total: 900 },
      }).success
    ).toBe(false);
  });

  it('includes a positive assurance fee in the payable invariant', () => {
    const withAssurance = {
      ...checkout,
      order: { ...checkout.order, total: 147.5 },
      redvault: {
        ...checkout.redvault,
        quote: {
          ...checkout.redvault.quote,
          assurance_fee_kobo: 3000,
          payable_kobo: 14750,
        },
      },
    };
    expect(RedvaultCheckoutSchema.parse(withAssurance)).toEqual(withAssurance);
  });

  it.each([
    { discount_kobo: 10001 },
    { ineligible_subtotal_kobo: 999 },
    { mixed_basket: false },
    { payable_kobo: 11749 },
  ])('rejects an inconsistent persisted quote: %o', (invalidQuote) => {
    expect(
      RedvaultCheckoutSchema.safeParse({
        ...checkout,
        redvault: {
          ...checkout.redvault,
          quote: { ...checkout.redvault.quote, ...invalidQuote },
        },
      }).success
    ).toBe(false);
  });
});
