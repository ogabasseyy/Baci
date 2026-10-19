import { describe, expect, it } from 'vitest';
import type { OrderCreateInput } from '@/schemas/orders';
import {
  buildAgenticOrderItems,
  buildAgenticOrderRpcArgs,
} from './checkout-order-rpc-args';

function body(items: OrderCreateInput['items']): OrderCreateInput {
  return {
    customer_email: 'buyer@example.com',
    customer_name: 'Buyer',
    discount_amount: 0,
    gift_wrapping_fee: 250,
    items,
    merchant_id: 'merchant-1',
    payment_method: 'card',
    payment_status: 'pending',
    shipping_fee: 100,
    shipping_status: 'pending',
    source: 'agentic',
  } as OrderCreateInput;
}

describe('buildAgenticOrderItems', () => {
  it('maps negotiated price, assurance fee and cart-line provenance', () => {
    const [item] = buildAgenticOrderItems(
      body([
        {
          cart_line_id: 'line-1',
          condition: 'used',
          has_assurance: true,
          id: 'product-1',
          negotiatedPrice: 200,
          price: 300,
          quantity: 2,
          variantId: 'variant-1',
        } as OrderCreateInput['items'][number],
      ])
    );
    expect(item).toMatchObject({
      assurance_fee: 20,
      cart_line_id: 'line-1',
      condition: 'used',
      price: 200,
      product_id: 'product-1',
      quantity: 2,
      variant_id: 'variant-1',
    });
  });

  it('omits cart_line_id and assurance fee for plain items', () => {
    const [item] = buildAgenticOrderItems(
      body([
        {
          id: 'product-2',
          price: 50,
          quantity: 1,
        } as OrderCreateInput['items'][number],
      ])
    );
    expect(item).not.toHaveProperty('cart_line_id');
    expect(item.assurance_fee).toBe(0);
    expect(item.price).toBe(50);
  });
});

describe('buildAgenticOrderRpcArgs', () => {
  it('forwards gift wrapping, expected total and the recomputed tax', () => {
    const args = buildAgenticOrderRpcArgs(
      { ...body([]), expected_total: 1234 } as OrderCreateInput,
      [],
      77
    );
    expect(args.p_gift_wrapping_fee).toBe(250);
    expect(args.p_expected_total).toBe(1234);
    expect(args.p_tax_amount).toBe(77);
    expect(args.p_user_id).toBeNull();
  });

  it('nulls a non-numeric expected total so the parity guard is skipped', () => {
    const args = buildAgenticOrderRpcArgs(body([]), [], 0);
    expect(args.p_expected_total).toBeNull();
  });
});
