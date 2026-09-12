import { describe, expect, it } from 'vitest';
import { storefrontAgentUiContract } from './storefront-agent-ui-contract';

const validProduct = {
  brand: 'Apple',
  category: 'Smartphones',
  description: 'A current catalog product.',
  hasVariants: false,
  id: 'product-1',
  imageUrl: 'https://cdn.example.com/iphone.jpg',
  manageStock: true,
  name: 'iPhone 16',
  price: 1_200_000,
  slug: 'iphone-16',
  stock: 4,
};

describe('storefrontAgentUiContract', () => {
  it.each([
    [{ condition: 'used', minimumOrderQuantity: 3 }, true],
    [{ condition: null, minimumOrderQuantity: null }, true],
    [{ condition: 42 }, false],
    [{ minimumOrderQuantity: 0 }, false],
    [{ minimumOrderQuantity: 1.5 }, false],
  ])('validates product selection metadata %j', (metadata, success) => {
    expect(
      storefrontAgentUiContract.eventSchema.safeParse({
        type: 'present_products',
        intent: 'discover',
        title: 'Products',
        products: [{ ...validProduct, ...metadata }],
      }).success
    ).toBe(success);
  });
  it('accepts a bounded product presentation response', () => {
    const result = storefrontAgentUiContract.responseSchema.safeParse({
      events: [
        {
          intent: 'discover',
          products: [validProduct],
          title: 'Products I found',
          type: 'present_products',
        },
      ],
      text: 'Here are the phones I found.',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects model-selected component or action fields', () => {
    const result = storefrontAgentUiContract.eventSchema.safeParse({
      action: { type: 'complete_purchase', url: 'https://evil.example' },
      component: 'ArbitraryHtml',
      intent: 'discover',
      products: [validProduct],
      title: 'Products I found',
      type: 'present_products',
    });

    expect(result.success).toBe(false);
  });

  it('rejects non-HTTP product image protocols', () => {
    const result = storefrontAgentUiContract.eventSchema.safeParse({
      intent: 'discover',
      products: [{ ...validProduct, imageUrl: 'javascript:alert(1)' }],
      title: 'Products I found',
      type: 'present_products',
    });

    expect(result.success).toBe(false);
  });

  it('rejects unsafe generated cart quantities', () => {
    const result = storefrontAgentUiContract.eventSchema.safeParse({
      intent: 'add_to_cart',
      products: [{ ...validProduct, quantity: 100 }],
      title: 'Ready to add',
      type: 'present_products',
    });

    expect(result.success).toBe(false);
  });

  it('rejects more products or events than the renderer allows', () => {
    const tooManyProducts = Array.from({ length: 7 }, (_, index) => ({
      ...validProduct,
      id: `product-${index}`,
    }));
    const event = {
      intent: 'discover' as const,
      products: [validProduct],
      title: 'Products I found',
      type: 'present_products' as const,
    };

    expect(
      storefrontAgentUiContract.eventSchema.safeParse({
        ...event,
        products: tooManyProducts,
      }).success
    ).toBe(false);
    expect(
      storefrontAgentUiContract.responseSchema.safeParse({
        events: [event, event, event, event],
        text: 'Too many events.',
        version: 1,
      }).success
    ).toBe(false);
  });
});
