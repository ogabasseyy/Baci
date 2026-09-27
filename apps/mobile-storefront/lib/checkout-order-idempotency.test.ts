import { jest } from '@jest/globals';
import {
  buildMobileCheckoutFingerprint,
  buildMobileCheckoutOrderFingerprint,
  buildMobileCheckoutOrderItems,
  calculateMobileCheckoutAssuranceFee,
  clearMobileCheckoutIdempotencyKey,
  getMobileCheckoutIdempotencyKey,
  type MobileCheckoutIdempotencyState,
} from './checkout-order-idempotency';

const mockRandomUUID = jest.fn();

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

const baseInput = {
  customerEmail: 'Ada@Example.com ',
  customerName: ' Ada Lovelace ',
  customerPhone: ' 08031234567 ',
  deliveryMethod: 'pickup_station',
  discountAmount: 0,
  items: [
    {
      assuranceFee: 0,
      hasAssurance: false,
      id: 'prod-b',
      price: 2000,
      productId: 'prod-b',
      quantity: 1,
      variantId: null,
    },
    {
      assuranceFee: 100,
      hasAssurance: true,
      id: 'prod-a',
      price: 1000,
      productId: 'prod-a',
      quantity: 2,
      variantAttributes: { Color: 'Blue', Storage: '128GB' },
      variantId: 'variant-a',
    },
  ],
  savingsAmount: 0,
  savingsGoalId: null,
  selectedQuoteId: null,
  shippingAddress: {
    address: 'No. 5 Example Plaza',
    city: 'Lagos',
    firstName: 'Ada',
    lastName: 'Lovelace',
    notes: '',
    state: 'Lagos',
  },
  shippingFee: 2000,
  shippingProvider: 'pickup_station',
  subtotal: 4000,
  taxAmount: 0,
  walletAmount: 0,
};

describe('checkout-order-idempotency', () => {
  beforeEach(() => {
    mockRandomUUID.mockReset();
    mockRandomUUID
      .mockReturnValueOnce('mobile-key-1')
      .mockReturnValueOnce('mobile-key-2');
  });

  it('builds the same fingerprint when only item order changes', () => {
    const first = buildMobileCheckoutFingerprint(baseInput);
    const second = buildMobileCheckoutFingerprint({
      ...baseInput,
      items: [...baseInput.items].reverse(),
    });

    expect(second).toBe(first);
  });

  it('distinguishes two different discount codes with the same amount', () => {
    const codeA = buildMobileCheckoutFingerprint({
      ...baseInput,
      discountAmount: 0,
      discountCode: 'SAVE10',
    });
    const codeB = buildMobileCheckoutFingerprint({
      ...baseInput,
      discountAmount: 0,
      discountCode: 'WELCOME',
    });

    expect(codeA).not.toBe(codeB);
  });

  it('distinguishes merchant delivery rates in the checkout fingerprint', () => {
    const orderItems = buildMobileCheckoutOrderItems(
      [
        {
          name: 'Phone',
          price: 1000,
          product_id: 'prod-a',
          quantity: 1,
        },
      ],
      0.05
    );
    const first = buildMobileCheckoutFingerprint({
      ...baseInput,
      shippingRateId: '11111111-1111-4111-8111-111111111111',
    });
    const second = buildMobileCheckoutFingerprint({
      ...baseInput,
      shippingRateId: '22222222-2222-4222-8222-222222222222',
    });
    const firstOrderFingerprint = buildMobileCheckoutOrderFingerprint({
      ...baseInput,
      items: orderItems,
      shippingRateId: '11111111-1111-4111-8111-111111111111',
    });
    const secondOrderFingerprint = buildMobileCheckoutOrderFingerprint({
      ...baseInput,
      items: orderItems,
      shippingRateId: '22222222-2222-4222-8222-222222222222',
    });

    expect(first).not.toBe(second);
    expect(firstOrderFingerprint).not.toBe(secondOrderFingerprint);
  });

  it('builds the same fingerprint for reordered duplicate product and variant lines', () => {
    const blueLine = {
      assuranceFee: 100,
      hasAssurance: true,
      id: 'prod-a',
      price: 1000,
      productId: 'prod-a',
      quantity: 1,
      variantAttributes: { Color: 'Blue', Storage: '128GB' },
      variantId: 'variant-a',
    };
    const greenLine = {
      assuranceFee: 0,
      hasAssurance: false,
      id: 'prod-a',
      price: 1100,
      productId: 'prod-a',
      quantity: 2,
      variantAttributes: { Color: 'Green', Storage: '256GB' },
      variantId: 'variant-a',
    };

    const first = buildMobileCheckoutFingerprint({
      ...baseInput,
      items: [blueLine, greenLine],
    });
    const second = buildMobileCheckoutFingerprint({
      ...baseInput,
      items: [greenLine, blueLine],
    });

    expect(second).toBe(first);
  });

  it('builds order payload items with negotiated prices and assurance fees', () => {
    const orderItems = buildMobileCheckoutOrderItems(
      [
        {
          image_url: 'https://example.com/phone.jpg',
          name: 'Phone',
          negotiatedPrice: 90_000,
          price: 100_000,
          product_id: 'prod-phone',
          quantity: 2,
          variant_attributes: { Storage: '256GB' },
          variant_id: 'variant-phone',
          hasAssurance: true,
          assuranceRate: 0.1,
        },
      ],
      0.05
    );

    expect(orderItems).toEqual([
      {
        id: 'prod-phone',
        product_id: 'prod-phone',
        name: 'Phone',
        quantity: 2,
        price: 90_000,
        image_url: 'https://example.com/phone.jpg',
        variant_id: 'variant-phone',
        variant_attributes: { Storage: '256GB' },
        has_assurance: true,
        assurance_fee: 18_000,
      },
    ]);
  });

  it('calculates assurance fees with the default and item-specific rates', () => {
    expect(
      calculateMobileCheckoutAssuranceFee([
        {
          name: 'Phone',
          price: 100_000,
          product_id: 'prod-phone',
          quantity: 2,
          hasAssurance: true,
        },
        {
          name: 'Case',
          negotiatedPrice: 5_000,
          price: 8_000,
          product_id: 'prod-case',
          quantity: 1,
          hasAssurance: true,
          assuranceRate: 0.1,
        },
        {
          name: 'Cable',
          price: 2_000,
          product_id: 'prod-cable',
          quantity: 3,
        },
      ])
    ).toBe(10_500);
  });

  it('builds the checkout fingerprint from order payload items', () => {
    const orderItems = buildMobileCheckoutOrderItems(
      [
        {
          condition: 'open_box',
          name: 'Phone',
          price: 1000,
          product_id: 'prod-a',
          quantity: 2,
          variant_attributes: { Color: 'Blue', Storage: '128GB' },
          variant_id: 'variant-a',
          hasAssurance: true,
          assuranceRate: 0.05,
        },
      ],
      0.05
    );

    const fingerprint = buildMobileCheckoutOrderFingerprint({
      ...baseInput,
      items: orderItems,
    });

    expect(fingerprint).toBe(
      buildMobileCheckoutFingerprint({
        ...baseInput,
        items: [
          {
            assuranceFee: 100,
            condition: 'open_box',
            hasAssurance: true,
            id: 'prod-a',
            price: 1000,
            productId: 'prod-a',
            quantity: 2,
            variantAttributes: { Color: 'Blue', Storage: '128GB' },
            variantId: 'variant-a',
          },
        ],
      })
    );
  });

  it('normalizes empty optional shipping fields consistently', () => {
    const withNulls = buildMobileCheckoutFingerprint({
      ...baseInput,
      selectedQuoteId: null,
      shippingProvider: null,
    });
    const withUndefined = buildMobileCheckoutFingerprint({
      ...baseInput,
      selectedQuoteId: undefined,
      shippingProvider: undefined,
    });
    const withEmptyStrings = buildMobileCheckoutFingerprint({
      ...baseInput,
      selectedQuoteId: ' ',
      shippingProvider: '',
    });

    expect(withUndefined).toBe(withNulls);
    expect(withEmptyStrings).toBe(withNulls);
  });

  it('collapses repeated whitespace while normalizing text fields', () => {
    const withExtraWhitespace = buildMobileCheckoutFingerprint({
      ...baseInput,
      customerName: ' Ada   Lovelace ',
      shippingAddress: {
        ...baseInput.shippingAddress,
        address: 'No.  5    Example Plaza',
      },
    });
    const normalized = buildMobileCheckoutFingerprint({
      ...baseInput,
      customerName: 'Ada Lovelace',
      shippingAddress: {
        ...baseInput.shippingAddress,
        address: 'No. 5 Example Plaza',
      },
    });

    expect(withExtraWhitespace).toBe(normalized);
  });

  it('reuses one key while the checkout fingerprint is stable', () => {
    const ref: { current: MobileCheckoutIdempotencyState | null } = {
      current: null,
    };
    const fingerprint = buildMobileCheckoutFingerprint(baseInput);

    expect(getMobileCheckoutIdempotencyKey(ref, fingerprint)).toBe(
      'mobile-key-1'
    );
    expect(getMobileCheckoutIdempotencyKey(ref, fingerprint)).toBe(
      'mobile-key-1'
    );
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
  });

  it('rotates the key when commercial checkout details change', () => {
    const ref: { current: MobileCheckoutIdempotencyState | null } = {
      current: null,
    };
    const first = buildMobileCheckoutFingerprint(baseInput);
    const second = buildMobileCheckoutFingerprint({
      ...baseInput,
      shippingFee: 3000,
    });

    expect(getMobileCheckoutIdempotencyKey(ref, first)).toBe('mobile-key-1');
    expect(getMobileCheckoutIdempotencyKey(ref, second)).toBe('mobile-key-2');
  });

  it('clears only the matching checkout key when a fingerprint is supplied', () => {
    const ref: { current: MobileCheckoutIdempotencyState | null } = {
      current: null,
    };
    const fingerprint = buildMobileCheckoutFingerprint(baseInput);

    getMobileCheckoutIdempotencyKey(ref, fingerprint);
    clearMobileCheckoutIdempotencyKey(ref, 'different-fingerprint');
    expect(ref.current?.key).toBe('mobile-key-1');

    clearMobileCheckoutIdempotencyKey(ref, fingerprint);
    expect(ref.current).toBeNull();
  });
});
