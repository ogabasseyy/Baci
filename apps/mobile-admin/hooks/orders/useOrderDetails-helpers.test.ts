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

  it('carries the stored offer label snapshot for display', () => {
    const result = mapOrderItems([
      {
        condition: 'used',
        has_assurance: null,
        id: 'item-1',
        image_url: null,
        item_description: null,
        name: 'Phone',
        offer_id: 'offer-7',
        offer_grade: 'B',
        offer_condition_notes: 'Light wear',
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

    expect(result).toEqual([
      expect.objectContaining({
        offer_id: 'offer-7',
        offer_grade: 'B',
        offer_condition_notes: 'Light wear',
      }),
    ]);
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

  it('prefers the stored snapshot over the mutable catalog row', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: [
        {
          offer_id: 'offer-7',
          grade: 'D',
          condition_notes: 'Revised after sale',
        },
      ],
      error: null,
    }));

    const result = await attachOrderItemOfferLabels(
      [
        {
          offer_id: 'offer-7',
          offer_grade: 'B',
          offer_condition_notes: 'Light wear',
          product_id: 'product-1',
        },
      ],
      fetchOffers
    );

    // No catalog read at all: the snapshot is the creation-time truth
    // even though the live offer now carries different labels.
    expect(fetchOffers).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      offer_grade: 'B',
      offer_condition_notes: 'Light wear',
    });
  });

  it('falls back to the live lookup for pre-snapshot lines', async () => {
    const fetchOffers = vi.fn(async () => ({
      data: [
        {
          offer_id: 'offer-7',
          grade: 'B',
          condition_notes: 'Light wear',
        },
      ],
      error: null,
    }));

    const result = await attachOrderItemOfferLabels(
      [
        {
          offer_id: 'offer-7',
          offer_grade: null,
          offer_condition_notes: null,
          product_id: 'product-1',
        },
      ],
      fetchOffers
    );

    expect(fetchOffers).toHaveBeenCalledTimes(1);
    expect(result[0]).toMatchObject({
      offer_grade: 'B',
      offer_condition_notes: 'Light wear',
    });
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

  it('fans offer lookups out in bounded batches', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchOffers = vi.fn(async (productId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {
        data: [{ offer_id: `offer-for-${productId}`, grade: 'B' }],
        error: null,
      };
    });
    const items = Array.from({ length: 25 }, (_, index) => ({
      offer_id: `offer-for-product-${index}`,
      product_id: `product-${index}`,
    }));

    const result = await attachOrderItemOfferLabels(items, fetchOffers);

    expect(fetchOffers).toHaveBeenCalledTimes(25);
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(result).toHaveLength(25);
    expect(result[24]).toMatchObject({ offer_grade: 'B' });
  });
});
