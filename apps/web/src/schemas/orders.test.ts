import { describe, expect, it } from 'vitest';
import {
  orderCreateSchema,
  orderUpdateSchema,
  reuseCheckoutOrderSchema,
} from './orders';

const validOrder = {
  merchant_id: '123e4567-e89b-12d3-a456-426614174000',
  customer_email: 'test@example.com',
  customer_name: 'John Doe',
  customer_phone: '+234 800 123 4567',
  items: [
    {
      name: 'Test Product',
      quantity: 1,
      price: 1000,
      productId: 'prod-1',
    },
  ],
  subtotal: 1000,
  payment_method: 'card',
};

describe('orderCreateSchema', () => {
  it('accepts valid input', () => {
    const result = orderCreateSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
  });

  it('accepts an optional discount_code', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      discount_code: 'SAVE10',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a uuid shipping_rate_id and preserves it', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      shipping_rate_id: '123e4567-e89b-12d3-a456-426614174777',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipping_rate_id).toBe(
        '123e4567-e89b-12d3-a456-426614174777'
      );
    }
  });

  it('accepts an explicit null shipping_rate_id (no merchant rate selected)', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      shipping_rate_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipping_rate_id).toBeNull();
    }
  });

  it('rejects a non-uuid shipping_rate_id', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      shipping_rate_id: 'mrate_not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an over-long discount_code', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      discount_code: 'X'.repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only discount_code', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      discount_code: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a complete savings credit payload', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      savings_amount: 500,
      savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
      use_savings_credit: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.use_savings_credit).toBe(true);
      expect(result.data.savings_goal_id).toBe(
        '123e4567-e89b-12d3-a456-426614174555'
      );
      expect(result.data.savings_amount).toBe(500);
    }
  });

  it('rejects incomplete savings credit payloads', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      savings_amount: 500,
      use_savings_credit: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects active savings credit without a savings amount', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
      use_savings_credit: true,
    });

    expect(result.success).toBe(false);
  });

  it('defaults savings credit off when fields are omitted', () => {
    const result = orderCreateSchema.safeParse(validOrder);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.use_savings_credit).toBe(false);
      expect(result.data.savings_goal_id).toBeUndefined();
      expect(result.data.savings_amount).toBeUndefined();
    }
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('rejects %s savings amounts when savings credit is active', (_, amount) => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      savings_amount: amount,
      savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
      use_savings_credit: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an invalid savings goal id when savings credit is active', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      savings_amount: 500,
      savings_goal_id: 'not-a-uuid',
      use_savings_credit: true,
    });

    expect(result.success).toBe(false);
  });

  it('does not require savings fields when savings credit is explicitly false', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      use_savings_credit: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.use_savings_credit).toBe(false);
    }
  });

  it('sanitizes XSS from customer_name', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      customer_name: '<script></script>jOhN dOE',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_name).not.toContain('<script>');
      expect(result.data.customer_name).toBe('John Doe');
    }
  });

  it('sanitizes XSS from item names', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          name: '<img src=x onerror=alert(1)>Product',
          quantity: 1,
          price: 100,
          productId: 'prod-1',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].name).not.toContain('<img');
    }
  });

  it('sanitizes email to lowercase', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      customer_email: 'Test@Example.COM',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_email).toBe('test@example.com');
    }
  });

  it('strips script tags from notes', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      notes: 'Please deliver <script>alert(1)</script> quickly',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).not.toContain('<script>');
      expect(result.data.notes).toContain('quickly');
    }
  });

  it('preserves valid phone numbers', () => {
    const result = orderCreateSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_phone).toBe('+234 800 123 4567');
    }
  });

  it('rejects missing merchant_id', () => {
    const { merchant_id: _, ...noMerchant } = validOrder;
    const result = orderCreateSchema.safeParse(noMerchant);
    expect(result.success).toBe(false);
  });

  it('rejects empty items array', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('maps shipping_quote_id into selected_quote_id', () => {
    const quoteId = '123e4567-e89b-12d3-a456-426614174111';
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      shipping_quote_id: quoteId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selected_quote_id).toBe(quoteId);
    }
  });

  it('preserves international destination fields on shipping addresses', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      shipping_address: {
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
        postalCode: 'M5V 3L9',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.shipping_address).toMatchObject({
      country: 'Canada',
      countryCode: 'CA',
      postalCode: 'M5V 3L9',
    });
  });

  it('prefers selected_quote_id when both quote fields are present', () => {
    const selectedQuoteId = '123e4567-e89b-12d3-a456-426614174112';
    const legacyQuoteId = '123e4567-e89b-12d3-a456-426614174113';
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      selected_quote_id: selectedQuoteId,
      shipping_quote_id: legacyQuoteId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selected_quote_id).toBe(selectedQuoteId);
    }
  });

  it('accepts null image_url / imageUrl on items (clients may serialize optional URLs as null)', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          image_url: null,
          imageUrl: null,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].image_url).toBeUndefined();
      expect(result.data.items[0].imageUrl).toBeUndefined();
    }
  });

  it('accepts a valid http image_url on items', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          image_url: 'https://cdn.example.com/p.jpg',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].image_url).toBe(
        'https://cdn.example.com/p.jpg'
      );
    }
  });

  it('normalizes item condition values', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          condition: 'Open Box',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].condition).toBe('open_box');
    }
  });

  it('normalizes blank and sanitized-empty voucher tokens to undefined', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: '   ',
          voucher_token: '   ',
        },
        {
          ...validOrder.items[0],
          productId: 'prod-2',
          voucherAwardId: '<script></script>',
          voucher_token: '<script></script>',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].voucher_award_id).toBeUndefined();
      expect(result.data.items[0].voucher_token).toBeUndefined();
      expect(result.data.items[1].voucherAwardId).toBeUndefined();
      expect(result.data.items[1].voucher_token).toBeUndefined();
    }
  });

  it('trims and sanitizes voucher tokens', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: '  <strong>quiz-award</strong>  ',
          voucher_token: '  <strong>quiz-token</strong>  ',
        },
        {
          ...validOrder.items[0],
          productId: 'prod-2',
          voucherAwardId: '  <strong>camel-award</strong>  ',
          voucherToken: '  <strong>camel-token</strong>  ',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].voucher_award_id).toBe('quiz-award');
      expect(result.data.items[0].voucher_token).toBe('quiz-token');
      expect(result.data.items[1].voucherAwardId).toBe('camel-award');
      expect(result.data.items[1].voucherToken).toBe('camel-token');
    }
  });

  it('rejects mismatched voucher token aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_token: 'quiz-token',
          voucherToken: 'other-token',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects offer IDs on quiz-voucher lines', () => {
    for (const voucher of [
      { voucher_token: 'quiz-token' },
      { voucherToken: 'quiz-token' },
      { voucher_award_id: 'quiz-award' },
      { voucherAwardId: 'quiz-award' },
    ]) {
      for (const offer of [{ offer_id: 'o1' }, { offerId: 'o1' }]) {
        const result = orderCreateSchema.safeParse({
          ...validOrder,
          items: [{ ...validOrder.items[0], ...voucher, ...offer }],
        });

        expect(result.success).toBe(false);
      }
    }
  });

  it('rejects mismatched voucher award ID aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: 'quiz-award',
          voucherAwardId: 'other-award',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects mismatched variant name aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          variantName: '512GB',
          variant_name: '1TB',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects mismatched offer ID aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          offerId: '55555555-5555-4555-8555-555555555555',
          offer_id: '66666666-6666-4666-8666-666666666666',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts matching offer ID aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          offerId: '55555555-5555-4555-8555-555555555555',
          offer_id: '55555555-5555-4555-8555-555555555555',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects lines combining a variant with a condition offer', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          variantId: '77777777-7777-4777-8777-777777777777',
          offerId: '55555555-5555-4555-8555-555555555555',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('caps order items at 200 lines', () => {
    const line = validOrder.items[0];
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        items: Array.from({ length: 200 }, () => ({ ...line })),
      }).success
    ).toBe(true);
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        items: Array.from({ length: 201 }, () => ({ ...line })),
      }).success
    ).toBe(false);
  });

  it('accepts null variant name aliases as absent optional fields', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          variantName: null,
          variant_name: null,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].variantName).toBeUndefined();
      expect(result.data.items[0].variant_name).toBeUndefined();
    }
  });

  it('normalizes blank variant name aliases as absent optional fields', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          variantName: '   ',
          variant_name: '<span></span>',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].variantName).toBeUndefined();
      expect(result.data.items[0].variant_name).toBeUndefined();
    }
  });

  it('accepts matching sanitized variant name aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          variantName: '  <strong>512GB</strong>  ',
          variant_name: '512GB',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].variantName).toBe('512GB');
      expect(result.data.items[0].variant_name).toBe('512GB');
    }
  });

  it('accepts matching voucher token aliases', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: '  quiz-award  ',
          voucherAwardId: '<strong>quiz-award</strong>',
          voucher_token: '  quiz-token  ',
          voucherToken: '<strong>quiz-token</strong>',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].voucher_award_id).toBe('quiz-award');
      expect(result.data.items[0].voucherAwardId).toBe('quiz-award');
      expect(result.data.items[0].voucher_token).toBe('quiz-token');
      expect(result.data.items[0].voucherToken).toBe('quiz-token');
    }
  });

  it('accepts signed quiz voucher tokens up to 512 sanitized characters long', () => {
    const voucherToken = 'x'.repeat(512);
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: voucherToken,
          voucher_token: voucherToken,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].voucher_award_id).toBe(voucherToken);
      expect(result.data.items[0].voucher_token).toBe(voucherToken);
    }
  });

  it('rejects voucher tokens longer than 512 sanitized characters', () => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: 'x'.repeat(513),
          voucher_token: 'x'.repeat(513),
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('accepts voucher tokens exactly 128 sanitized characters long for legacy Phase 1a clients', () => {
    const voucherToken = 'x'.repeat(128);
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      items: [
        {
          ...validOrder.items[0],
          voucher_award_id: voucherToken,
          voucher_token: voucherToken,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].voucher_award_id).toBe(voucherToken);
      expect(result.data.items[0].voucher_token).toBe(voucherToken);
    }
  });

  describe('B3.5 — VAT / total parity fields', () => {
    it("defaults tax_basis to 'exclusive' when omitted", () => {
      const result = orderCreateSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tax_basis).toBe('exclusive');
      }
    });

    it("accepts tax_basis: 'inclusive'", () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        tax_basis: 'inclusive',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tax_basis).toBe('inclusive');
      }
    });

    it("rejects tax_basis outside the 'exclusive'/'inclusive' enum", () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        tax_basis: 'mixed',
      });
      expect(result.success).toBe(false);
    });

    it('defaults gift_wrapping_fee to 0 when omitted', () => {
      const result = orderCreateSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gift_wrapping_fee).toBe(0);
      }
    });

    it('rejects negative gift_wrapping_fee', () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        gift_wrapping_fee: -1,
      });
      expect(result.success).toBe(false);
    });

    it('coerces gift_wrapping_fee from numeric string', () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        gift_wrapping_fee: '500',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.gift_wrapping_fee).toBe(500);
      }
    });

    it('accepts expected_total and client_total as optional numerics', () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        expected_total: 1100,
        client_total: 1100,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expected_total).toBe(1100);
        expect(result.data.client_total).toBe(1100);
      }
    });

    it('rejects negative expected_total', () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        expected_total: -50,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative client_total', () => {
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        client_total: -50,
      });
      expect(result.success).toBe(false);
    });

    it('treats expected_total / client_total as undefined when absent', () => {
      const result = orderCreateSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expected_total).toBeUndefined();
        expect(result.data.client_total).toBeUndefined();
      }
    });

    it('preserves null on expected_total / client_total instead of coercing to 0', () => {
      // Codex P1 (PR #1622): pre-fix the schema used `z.coerce.number()`
      // which calls `Number(null) === 0`. A client sending
      // `expected_total: null` would silently become `0` and the RPC's
      // parity check (subtotal + shipping + gift + tax - discount vs
      // 0) would always RAISE `order_total_mismatch` 400.
      const result = orderCreateSchema.safeParse({
        ...validOrder,
        expected_total: null,
        client_total: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.expected_total).toBeNull();
        expect(result.data.client_total).toBeNull();
      }
    });
  });
});

describe('reuseCheckoutOrderSchema', () => {
  const validReuse = {
    order_id: '4dc0ee52-d9c4-406a-b6ca-80c84eef6a8f',
    merchant_id: 'e6e2e46c-5e3c-40c1-b0ae-832d6d20f0a2',
    tracking_token: 'tracking-token-123',
    customer_email: 'john@example.com',
    payment_method: 'card',
  };

  it('accepts a valid reuse payload without a merchant rate id', () => {
    const result = reuseCheckoutOrderSchema.safeParse(validReuse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipping_rate_id).toBeUndefined();
    }
  });

  it('accepts a bare uuid shipping_rate_id and preserves it', () => {
    const result = reuseCheckoutOrderSchema.safeParse({
      ...validReuse,
      shipping_rate_id: '123e4567-e89b-12d3-a456-426614174777',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipping_rate_id).toBe(
        '123e4567-e89b-12d3-a456-426614174777'
      );
    }
  });

  it('accepts an explicit null shipping_rate_id', () => {
    const result = reuseCheckoutOrderSchema.safeParse({
      ...validReuse,
      shipping_rate_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shipping_rate_id).toBeNull();
    }
  });

  it('rejects the synthetic mrate_-prefixed id (not a bare uuid)', () => {
    const result = reuseCheckoutOrderSchema.safeParse({
      ...validReuse,
      shipping_rate_id: 'mrate_123e4567-e89b-12d3-a456-426614174777',
    });
    expect(result.success).toBe(false);
  });
});

describe('orderUpdateSchema', () => {
  it('accepts supported status and editable order fields', () => {
    const result = orderUpdateSchema.safeParse({
      payment_status: 'paid',
      shipping_status: 'completed',
      merchant_id: '123e4567-e89b-12d3-a456-426614174000',
      notes: null,
      shipping_address: { city: 'Lagos' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported shipping statuses and unknown fields', () => {
    expect(
      orderUpdateSchema.safeParse({ shipping_status: 'teleported' }).success
    ).toBe(false);
    expect(orderUpdateSchema.safeParse({ unexpected: true }).success).toBe(
      false
    );
  });
});
