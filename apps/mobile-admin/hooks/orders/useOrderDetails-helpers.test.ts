import { describe, expect, it, vi } from 'vitest';
import {
  attachOrderItemOfferLabels,
  mapOrderItems,
} from './useOrderDetails-helpers';

describe('mapOrderItems', () => {
  it('maps item and product fallbacks for order details', () => {
    const result = mapOrderItems([
      {
        condition: null,
        has_assurance: true,
        id: 'item-1',
        image_url: null,
        item_description: 'A replacement screen',
        name: null,
        price: 12500,
        product_match_status: 'linked',
        product_id: 'product-1',
        products: {
          categories: { name: 'Phones', slug: 'phones' },
          category: 'Legacy phones',
          condition: 'New',
          images: ['https://example.com/phone.jpg'],
          name: 'Phone',
        },
        quantity: 2,
        variant_attributes: { color: 'Black' },
        variant_id: 'variant-1',
        variant_name: 'Black',
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        category: 'Phones',
        category_slug: 'phones',
        details: 'A replacement screen',
        display_condition: 'New',
        display_image_url: 'https://example.com/phone.jpg',
        has_assurance: true,
        name: 'Phone',
        product_name: 'Phone',
        quantity: 2,
        variant_id: 'variant-1',
      }),
    ]);
  });

  it('returns no items for an absent item collection', () => {
    expect(mapOrderItems(null)).toEqual([]);
  });

  it('carries the order line offer id for offer-label resolution', () => {
    const result = mapOrderItems([
      {
        condition: 'used',
        has_assurance: null,
        id: 'item-1',
        image_url: null,
        item_description: null,
        name: 'Phone',
        offer_id: 'offer-7',
        price: 80000,
        product_match_status: 'linked',
        product_id: 'product-1',
        products: null,
        quantity: 1,
        variant_attributes: null,
        variant_id: null,
        variant_name: null,
      },
    ]);

    expect(result).toEqual([expect.objectContaining({ offer_id: 'offer-7' })]);
  });
});

describe('attachOrderItemOfferLabels', () => {
  it('attaches grade and notes for the selected offer with one lookup per product', async () => {
    const fetchOffers = vi.fn(async (productId: string) => ({
      data:
        productId === 'product-1'
          ? [
              {
                offer_id: 'offer-7',
                grade: 'B',
                condition_notes: 'Light wear',
              },
              { offer_id: 'offer-8', grade: 'A' },
            ]
          : [],
      error: null,
    }));

    const result = await attachOrderItemOfferLabels(
      [
        { offer_id: 'offer-7', product_id: 'product-1' },
        { offer_id: 'offer-7', product_id: 'product-1' },
        { product_id: 'product-2' },
      ],
      fetchOffers
    );

    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(fetchOffers).toHaveBeenCalledWith('product-1');
    expect(result[0]).toMatchObject({
      offer_grade: 'B',
      offer_condition_notes: 'Light wear',
    });
    expect(result[2]).not.toHaveProperty('offer_grade');
  });

  it('leaves items untouched when the offer lookup fails', async () => {
    const items = [{ offer_id: 'offer-7', product_id: 'product-1' }];

    await expect(
      attachOrderItemOfferLabels(items, async () => ({
        data: null,
        error: { message: 'boom' },
      }))
    ).resolves.toEqual(items);
    await expect(
      attachOrderItemOfferLabels(items, async () => {
        throw new Error('boom');
      })
    ).resolves.toEqual(items);
  });

  it('skips the lookup when no line names an offer', async () => {
    const fetchOffers = vi.fn();
    const items = [{ product_id: 'product-1' }];

    await expect(attachOrderItemOfferLabels(items, fetchOffers)).resolves.toBe(
      items
    );
    expect(fetchOffers).not.toHaveBeenCalled();
  });
});
