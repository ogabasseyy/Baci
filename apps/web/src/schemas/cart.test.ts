import { describe, expect, it } from 'vitest';
import {
  cartBootstrapRequestSchema,
  cartHandoffIssueRequestSchema,
  cartHandoffRedeemRequestSchema,
  cartValidateSchema,
  createCartRequestSchema,
  sharedCartMutationRequestSchema,
} from './cart';

const PRODUCT_ID = 'product-1';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_VARIANT_ID = '44444444-4444-4444-8444-444444444444';

describe('cartValidateSchema', () => {
  it('accepts variant-aware cart validation items', () => {
    const result = cartValidateSchema.safeParse({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 100,
          variantId: VARIANT_ID,
        },
        {
          id: 'product-2',
          price: 200,
          variant_id: OTHER_VARIANT_ID,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.cartItems).toEqual([
      {
        id: PRODUCT_ID,
        price: 100,
        variantId: VARIANT_ID,
      },
      {
        id: 'product-2',
        price: 200,
        variant_id: OTHER_VARIANT_ID,
      },
    ]);
  });

  it('rejects non-UUID variant ids', () => {
    const result = cartValidateSchema.safeParse({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 100,
          variantId: 'variant-1',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects conflicting variantId and variant_id', () => {
    const result = cartValidateSchema.safeParse({
      cartItems: [
        {
          id: PRODUCT_ID,
          price: 100,
          variantId: VARIANT_ID,
          variant_id: OTHER_VARIANT_ID,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects cartItems larger than 50 entries', () => {
    const cartItems = Array.from({ length: 51 }, (_, index) => ({
      id: `product-${index}`,
      price: 100 + index,
    }));

    const result = cartValidateSchema.safeParse({ cartItems });

    expect(result.success).toBe(false);
  });

  it('rejects productIds larger than 50 entries', () => {
    const productIds = Array.from({ length: 51 }, (_, index) => `id-${index}`);

    const result = cartValidateSchema.safeParse({ productIds });

    expect(result.success).toBe(false);
  });
});

describe('sharedCartMutationRequestSchema', () => {
  it('accepts a versioned add command with an operation id', () => {
    const result = sharedCartMutationRequestSchema.safeParse({
      command: {
        item: { productId: '11111111-1111-4111-8111-111111111111' },
        quantity: 2,
        type: 'add',
      },
      expectedVersion: 3,
      operationId: 'op-1',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown commands and missing versions', () => {
    expect(
      sharedCartMutationRequestSchema.safeParse({
        command: { type: 'explode' },
        expectedVersion: 1,
        operationId: 'op-1',
      }).success
    ).toBe(false);
    expect(
      sharedCartMutationRequestSchema.safeParse({
        command: { type: 'clear' },
        operationId: 'op-1',
      }).success
    ).toBe(false);
    expect(
      sharedCartMutationRequestSchema.safeParse({
        command: { type: 'clear' },
        expectedVersion: 0,
        operationId: 'op-1',
      }).success
    ).toBe(false);
  });

  it('rejects blank operation ids and client-supplied prices', () => {
    expect(
      sharedCartMutationRequestSchema.safeParse({
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: '   ',
      }).success
    ).toBe(false);
    expect(
      sharedCartMutationRequestSchema.safeParse({
        command: {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          price: 100,
          quantity: 1,
          type: 'add',
        },
        expectedVersion: 1,
        operationId: 'op-1',
      }).success
    ).toBe(false);
  });
});

describe('createCartRequestSchema', () => {
  it('accepts creation with optional initial lines and currency', () => {
    const result = createCartRequestSchema.safeParse({
      currency: 'NGN',
      lines: [
        {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          quantity: 1,
        },
      ],
      operationId: 'create-1',
    });

    expect(result.success).toBe(true);
  });

  it('rejects over-limit lines and non-ISO currencies', () => {
    const lines = Array.from({ length: 21 }, (_, index) => ({
      item: {
        productId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      },
      quantity: 1,
    }));
    expect(
      createCartRequestSchema.safeParse({
        lines: lines.slice(0, 20),
        operationId: 'within-cap',
      }).success
    ).toBe(true);
    expect(
      createCartRequestSchema.safeParse({ lines, operationId: 'create-1' })
        .success
    ).toBe(false);
    expect(
      createCartRequestSchema.safeParse({
        currency: 'naira',
        operationId: 'create-1',
      }).success
    ).toBe(false);
  });

  it('never accepts a client-supplied merchant override', () => {
    const result = createCartRequestSchema.safeParse({
      merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      operationId: 'create-9',
    });

    expect(result.success).toBe(false);
  });
});

describe('cartHandoffIssueRequestSchema', () => {
  it('accepts web and app-bound native destinations', () => {
    expect(
      cartHandoffIssueRequestSchema.safeParse({
        destination: { type: 'web' },
        operationId: 'handoff-op-1',
      }).success
    ).toBe(true);
    expect(
      cartHandoffIssueRequestSchema.safeParse({
        destination: { app: 'storefront', type: 'native' },
        operationId: 'handoff-op-2',
      }).success
    ).toBe(true);
  });

  it('rejects unknown destinations and merchant overrides', () => {
    expect(
      cartHandoffIssueRequestSchema.safeParse({
        destination: { type: 'sms' },
        operationId: 'handoff-op-1',
      }).success
    ).toBe(false);
    expect(
      cartHandoffIssueRequestSchema.safeParse({
        destination: { type: 'web' },
        merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        operationId: 'handoff-op-1',
      }).success
    ).toBe(false);
  });
});

describe('cartHandoffRedeemRequestSchema', () => {
  it('accepts a full merge redemption with resolutions', () => {
    const result = cartHandoffRedeemRequestSchema.safeParse({
      attemptId: 'attempt-1',
      choice: 'merge',
      destCartId: '22222222-2222-4222-8222-222222222222',
      expectedDestVersion: 2,
      expectedIncomingVersion: 3,
      handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      lines: [
        {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          quantity: 1,
        },
      ],
      resolutions: [
        {
          item: { productId: '11111111-1111-4111-8111-111111111111' },
          keep: 'incoming',
        },
      ],
      token: 'ch1.payload.signature',
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed tokens, ids and client prices', () => {
    const base = {
      attemptId: 'attempt-1',
      choice: 'connect',
      handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      token: 'ch1.payload.signature',
    };
    expect(
      cartHandoffRedeemRequestSchema.safeParse({ ...base, token: 'nope' })
        .success
    ).toBe(false);
    expect(
      cartHandoffRedeemRequestSchema.safeParse({ ...base, handoffId: 'nope' })
        .success
    ).toBe(false);
    expect(
      cartHandoffRedeemRequestSchema.safeParse({
        ...base,
        choice: 'merge',
        destCartId: '22222222-2222-4222-8222-222222222222',
        expectedDestVersion: 1,
        expectedIncomingVersion: 1,
        lines: [
          {
            item: { productId: '11111111-1111-4111-8111-111111111111' },
            quantity: 1,
            unitPriceMinor: 99,
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe('cartBootstrapRequestSchema', () => {
  it('accepts an empty body and an optional merchant hint', () => {
    expect(cartBootstrapRequestSchema.safeParse({}).success).toBe(true);
    const hinted = cartBootstrapRequestSchema.safeParse({
      merchantSlug: 'ogabassey',
    });
    expect(hinted.success).toBe(true);
    if (hinted.success) {
      expect(hinted.data.merchantSlug).toBe('ogabassey');
    }
  });

  it('rejects blank hints and unknown fields', () => {
    expect(
      cartBootstrapRequestSchema.safeParse({ merchantSlug: '  ' }).success
    ).toBe(false);
    expect(
      cartBootstrapRequestSchema.safeParse({
        merchantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }).success
    ).toBe(false);
  });
});

it('keeps the existing version and operation-id boundaries for shared mutations', () => {
  const valid = {
    operationId: 'x'.repeat(128),
    expectedVersion: 1,
    command: { type: 'clear' },
  };
  expect(sharedCartMutationRequestSchema.safeParse(valid).success).toBe(true);
  expect(
    sharedCartMutationRequestSchema.safeParse({ ...valid, expectedVersion: 0 })
      .success
  ).toBe(false);
  expect(
    sharedCartMutationRequestSchema.safeParse({
      ...valid,
      operationId: 'x'.repeat(129),
    }).success
  ).toBe(false);
});
it('requires a complete merge plan and both reviewed versions before redemption', () => {
  const merge = {
    attemptId: 'attempt',
    choice: 'merge',
    handoffId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    token: 'ch1.payload.signature',
    destCartId: '22222222-2222-4222-8222-222222222222',
    expectedIncomingVersion: 1,
    expectedDestVersion: 1,
    lines: [],
  };
  for (const key of [
    'lines',
    'destCartId',
    'expectedIncomingVersion',
    'expectedDestVersion',
  ]) {
    const candidate: Record<string, unknown> = { ...merge };
    delete candidate[key];
    expect(cartHandoffRedeemRequestSchema.safeParse(candidate).success).toBe(
      false
    );
  }
});
it('accepts the existing 400-character voucher contract in canonical cart commands', () => {
  expect(
    sharedCartMutationRequestSchema.safeParse({
      operationId: 'voucher-add',
      expectedVersion: 1,
      command: {
        type: 'add',
        item: { productId: '11111111-1111-4111-8111-111111111111' },
        quantity: 1,
        voucherToken: `qv1.${'a'.repeat(395)}`,
      },
    }).success
  ).toBe(true);
});
