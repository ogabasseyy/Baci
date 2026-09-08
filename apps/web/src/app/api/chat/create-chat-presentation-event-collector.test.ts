import { describe, expect, it } from 'vitest';
import { createChatPresentationEventCollector } from './create-chat-presentation-event-collector';

function product(index: number) {
  return {
    brand: 'Apple',
    category: 'Smartphones',
    description: `Phone ${index}`,
    has_variants: false,
    id: `product-${index}`,
    image_url: 'https://cdn.example.com/phone.jpg',
    manage_stock: true,
    name: `Phone ${index}`,
    price: 100_000 + index,
    slug: `phone-${index}`,
    status: 'active',
    stock: 3,
  };
}

describe('createChatPresentationEventCollector', () => {
  it('preserves a 255-character routing slug', () => {
    const collector = createChatPresentationEventCollector();
    const slug = 'a'.repeat(255);
    collector.capture('getProductDetails', { ...product(1), slug });
    expect(collector.getEvents()[0]?.products[0]?.slug).toBe(slug);
  });

  it('retains an add confirmation after discovery fills the event cap', () => {
    const collector = createChatPresentationEventCollector();
    for (const index of [1, 2, 3]) {
      collector.capture('getProductDetails', product(index));
    }
    expect(collector.capture('addToCart', product(4), { quantity: 2 })).toBe(
      true
    );
    expect(collector.getEvents()).toHaveLength(3);
    expect(collector.getEvents()[2]).toMatchObject({
      intent: 'add_to_cart',
      products: [{ id: 'product-4', quantity: 2 }],
    });
  });
  it('carries canonical selection metadata into the card', () => {
    const collector = createChatPresentationEventCollector();
    collector.capture('getProductDetails', {
      ...product(1),
      has_condition_offers: true,
      variant_model: 'sku_matrix',
      available_conditions: ['New', 'Used'],
      condition: 'used',
      minimum_order_quantity: 3,
    });
    expect(collector.getEvents()[0]?.products[0]).toMatchObject({
      hasConditionOffers: true,
      variantModel: 'sku_matrix',
      availableConditions: ['New', 'Used'],
      condition: 'used',
      minimumOrderQuantity: 3,
    });
  });
  it('maps trusted product search results into a bounded UI event', () => {
    const collector = createChatPresentationEventCollector();
    const result = collector.capture('searchProducts', {
      products: Array.from({ length: 8 }, (_, index) => product(index)),
      total: 8,
    });

    expect(result).toBe(true);
    expect(collector.getEvents()).toEqual([
      expect.objectContaining({
        intent: 'discover',
        title: 'Products I found',
        type: 'present_products',
        products: expect.arrayContaining([
          expect.objectContaining({
            id: 'product-0',
            imageUrl: 'https://cdn.example.com/phone.jpg',
          }),
        ]),
      }),
    ]);
    expect(collector.getEvents()[0]?.products).toHaveLength(6);
  });

  it('does not turn unknown tools or inactive products into UI', () => {
    const collector = createChatPresentationEventCollector();

    expect(collector.capture('runJavascript', { html: '<script />' })).toBe(
      false
    );
    expect(
      collector.capture('getProductDetails', {
        ...product(1),
        status: 'draft',
      })
    ).toBe(false);
    expect(collector.getEvents()).toEqual([]);
  });

  it('normalizes unsafe image URLs to no image', () => {
    const collector = createChatPresentationEventCollector();

    collector.capture('getProductDetails', {
      ...product(1),
      image_url: 'javascript:alert(1)',
    });

    expect(collector.getEvents()[0]?.products[0]?.imageUrl).toBeNull();
  });

  it('deduplicates repeated provider tool results', () => {
    const collector = createChatPresentationEventCollector();
    const result = { products: [product(1)], total: 1 };

    expect(collector.capture('searchProducts', result)).toBe(true);
    expect(collector.capture('searchProducts', JSON.stringify(result))).toBe(
      false
    );
    expect(collector.getEvents()).toHaveLength(1);
  });

  it('preserves a bounded customer-requested add-to-cart quantity', () => {
    const collector = createChatPresentationEventCollector();

    collector.capture('addToCart', product(1), { quantity: 2 });

    expect(collector.getEvents()[0]).toMatchObject({
      intent: 'add_to_cart',
      products: [{ id: 'product-1', quantity: 2 }],
    });
  });

  it.each([
    0, 100,
  ])('does not propagate an out-of-range add-to-cart quantity of %i', (quantity) => {
    const collector = createChatPresentationEventCollector();

    const captured = collector.capture('addToCart', product(1), {
      quantity,
    });

    expect(captured).toBe(true);
    expect(collector.getEvents()[0]?.products[0]).not.toHaveProperty(
      'quantity'
    );
  });

  it('keeps add-to-cart events for different quantities of the same product', () => {
    const collector = createChatPresentationEventCollector();

    expect(collector.capture('addToCart', product(1), { quantity: 1 })).toBe(
      true
    );
    expect(collector.capture('addToCart', product(1), { quantity: 2 })).toBe(
      true
    );

    expect(collector.getEvents()).toMatchObject([
      { products: [{ id: 'product-1', quantity: 1 }] },
      { products: [{ id: 'product-1', quantity: 2 }] },
    ]);
  });
});
