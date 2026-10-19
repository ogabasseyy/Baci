import { describe, expect, it, vi } from 'vitest';
import {
  ORDER_BINDING_RPC_NAMES,
  selectOrderBindingVariant,
  submitCartBoundOrder,
} from './order-binding';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '66666666-6666-4666-8666-666666666666';

function rawOrder(overrides: Record<string, unknown> = {}) {
  return {
    customer_email: 'buyer@example.com',
    customer_id: null,
    customer_name: 'Buyer',
    customer_phone: null,
    discount_amount: 0,
    gift_wrapping_fee: 0,
    id: ORDER_ID,
    idempotency_replayed: false,
    merchant_id: MERCHANT_ID,
    order_number: 'ORD-12345678',
    payment_method: 'card',
    payment_status: 'unpaid',
    shipping_address: null,
    shipping_fee: 0,
    shipping_status: 'pending',
    subtotal: 15,
    tax_amount: 0,
    tax_basis: 'exclusive',
    total: 15,
    tracking_token: 'tok-12345678',
    ...overrides,
  };
}

function rawBinding() {
  return {
    cartId: CART_ID,
    cartVersionReviewed: 3,
    checkout_generation: 1,
    merchantId: MERCHANT_ID,
    sessionId: SESSION_ID,
    variant: 'base',
  };
}

function clientReturning(value: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: value, error }) };
}

const ARGS = {
  p_customer_email: 'buyer@example.com',
  p_customer_name: 'Buyer',
  p_expected_total: 15,
  p_items: [],
  p_merchant_id: MERCHANT_ID,
};

describe('submitCartBoundOrder', () => {
  it('submits the reviewed session through the binding RPC', async () => {
    const client = clientReturning({
      binding: rawBinding(),
      code: null,
      ok: true,
      order: rawOrder(),
      replayed: false,
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(client.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_cart_binding',
      {
        p_args: ARGS,
        p_generation: 1,
        p_session_id: SESSION_ID,
        p_variant: 'base',
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replayed).toBe(false);
      expect(result.order.id).toBe(ORDER_ID);
      expect(result.order.order_number).toBe('ORD-12345678');
      expect(result.order.total).toBe(15);
      expect(result.order.idempotency_replayed).toBe(false);
      expect(result.binding.checkoutGeneration).toBe(1);
      expect(result.binding.variant).toBe('base');
    }
  });

  it('forwards the reviewed cart identity and verified principal', async () => {
    const client = clientReturning({
      binding: rawBinding(),
      code: null,
      ok: true,
      order: rawOrder(),
      replayed: false,
    });

    await submitCartBoundOrder(
      { client: client as never },
      {
        args: ARGS,
        cartId: '22222222-2222-4222-8222-222222222222',
        cartVersion: 3,
        generation: 1,
        principalId: 'guest-principal-001',
        sessionId: SESSION_ID,
        variant: 'base',
      }
    );

    expect(client.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_cart_binding',
      {
        p_args: {
          ...ARGS,
          p_cart_id: '22222222-2222-4222-8222-222222222222',
          p_cart_principal_id: 'guest-principal-001',
          p_cart_version: 3,
        },
        p_generation: 1,
        p_session_id: SESSION_ID,
        p_variant: 'base',
      }
    );
  });

  it('parses a replayed binding without resubmitting', async () => {
    const client = clientReturning({
      binding: rawBinding(),
      code: null,
      ok: true,
      order: rawOrder({ idempotency_replayed: true }),
      replayed: true,
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replayed).toBe(true);
      expect(result.order.id).toBe(ORDER_ID);
      expect(result.order.idempotency_replayed).toBe(true);
    }
  });

  it.each([
    ['cart_checkout_stale', 'refresh_required'],
    ['cart_checkout_not_found', 'not_found'],
    ['cart_checkout_expired', 'expired'],
    ['cart_order_unauthorized', 'unauthorized'],
    ['cart_order_merchant_mismatch', 'unauthorized'],
    ['cart_order_invalid_variant', 'invalid_item'],
  ] as const)('maps %s to %s', async (message, code) => {
    const client = clientReturning(null, { code: 'P0001', message });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toMatchObject({ code, message, ok: false });
  });

  it('passes variant-specific inner columns through the bound order', async () => {
    const client = clientReturning({
      binding: { ...rawBinding(), variant: 'savings' },
      code: null,
      ok: true,
      order: rawOrder({
        savings_goal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010',
        savings_goal_status: 'active',
        savings_redeemed_amount: 5,
        savings_redemption_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000010',
        savings_redemption_success: true,
      }),
      replayed: false,
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'savings' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.savings_redemption_success).toBe(true);
      expect(result.order.savings_redeemed_amount).toBe(5);
      expect(result.order.savings_goal_id).toBe(
        'aaaaaaaa-aaaa-4aaa-8aaa-000000000010'
      );
      expect(result.order.savings_redemption_id).toBe(
        'bbbbbbbb-bbbb-4bbb-8bbb-000000000010'
      );
      expect(result.order.savings_goal_status).toBe('active');
    }
  });

  it('leaves variant-specific columns undefined for the base receipt', async () => {
    const client = clientReturning({
      binding: rawBinding(),
      code: null,
      ok: true,
      order: rawOrder(),
      replayed: false,
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.savings_redemption_success).toBeUndefined();
      expect(result.order.savings_redeemed_amount).toBeUndefined();
      expect(result.order.savings_goal_id).toBeUndefined();
      expect(result.order.savings_redemption_id).toBeUndefined();
      expect(result.order.savings_goal_status).toBeUndefined();
    }
  });

  it('passes inner order rejections through with their message', async () => {
    const client = clientReturning(null, {
      code: 'P0001',
      message: 'order_total_mismatch',
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toMatchObject({
      code: 'order_rejected',
      message: 'order_total_mismatch',
      ok: false,
    });
  });

  it('preserves domain SQLSTATEs from inner order RPCs', async () => {
    const client = clientReturning(null, {
      code: '22023',
      message: 'The selected airport delivery quote has expired',
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toMatchObject({
      code: 'order_rejected',
      message: 'The selected airport delivery quote has expired',
      ok: false,
      sqlState: '22023',
    });
  });

  it('maps permission-denied to a fixed temporarily_unavailable', async () => {
    const client = clientReturning(null, {
      code: '42501',
      message: 'permission denied for function commerce_cart_bind_order',
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toEqual({
      code: 'temporarily_unavailable',
      message: 'Order binding request failed',
      ok: false,
    });
  });

  it('maps transport failures to temporarily_unavailable', async () => {
    const client = clientReturning(null, {
      code: 'XX000',
      message: 'connection reset',
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toEqual({
      code: 'temporarily_unavailable',
      message: 'Order binding request failed',
      ok: false,
    });
  });

  it('rejects an unknown variant without an RPC call', async () => {
    const client = clientReturning(null);

    const result = await submitCartBoundOrder(
      { client: client as never },
      {
        args: ARGS,
        generation: 1,
        sessionId: SESSION_ID,
        variant: 'group_deal' as never,
      }
    );

    expect(result).toMatchObject({ code: 'invalid_item', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed receipt', async () => {
    const client = clientReturning({
      binding: rawBinding(),
      code: null,
      ok: true,
      replayed: false,
    });

    const result = await submitCartBoundOrder(
      { client: client as never },
      { args: ARGS, generation: 1, sessionId: SESSION_ID, variant: 'base' }
    );

    expect(result).toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
    });
  });
});

describe('selectOrderBindingVariant', () => {
  it('prefers savings, then voucher, then discount code, then base', () => {
    expect(
      selectOrderBindingVariant({
        discountCodeId: 'code-1',
        hasVoucherItem: true,
        requestedSavingsRedemption: true,
      })
    ).toBe('savings');
    expect(
      selectOrderBindingVariant({
        discountCodeId: 'code-1',
        hasVoucherItem: true,
        requestedSavingsRedemption: false,
      })
    ).toBe('quiz_voucher');
    expect(
      selectOrderBindingVariant({
        discountCodeId: 'code-1',
        hasVoucherItem: false,
        requestedSavingsRedemption: false,
      })
    ).toBe('discount_code');
    expect(
      selectOrderBindingVariant({
        discountCodeId: null,
        hasVoucherItem: false,
        requestedSavingsRedemption: false,
      })
    ).toBe('base');
  });

  it('maps every variant to its direct order RPC', () => {
    expect(ORDER_BINDING_RPC_NAMES).toEqual({
      base: 'create_storefront_order',
      discount_code: 'create_storefront_order_with_discount_code',
      loyalty_code: 'create_storefront_order_with_loyalty_code',
      quiz_voucher: 'create_storefront_order_with_quiz_voucher',
      savings: 'create_storefront_order_with_savings',
    });
  });

  it('selects the loyalty variant only after discount precedence', () => {
    const base = {
      discountCodeId: null,
      hasVoucherItem: false,
      requestedSavingsRedemption: false,
    };
    expect(
      selectOrderBindingVariant({ ...base, loyaltyRedemptionId: 'redeem-1' })
    ).toBe('loyalty_code');
    expect(
      selectOrderBindingVariant({
        ...base,
        discountCodeId: 'code-1',
        loyaltyRedemptionId: 'redeem-1',
      })
    ).toBe('discount_code');
    expect(selectOrderBindingVariant(base)).toBe('base');
  });
});
