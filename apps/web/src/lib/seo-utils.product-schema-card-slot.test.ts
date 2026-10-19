import { describe, expect, it } from 'vitest';
import { generateProductSchema } from './seo-utils';
import { makeSeoProduct } from './seo-utils-product-schema-test-helper';

describe('generateProductSchema card-slot capability', () => {
  it('does not emit a camera card slot when the capability is explicitly false', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: {
          card_slot_type: 'CFexpress Type B',
          has_card_slot: false,
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).not.toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Card Slot',
          value: 'CFexpress Type B',
        },
      ])
    );
  });

  it('does not emit a mobile card slot when the capability is explicitly false', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Mobile Phones',
        product_key_specs: {
          card_slot_type: 'microSDXC',
          has_card_slot: false,
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).not.toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Card Slot',
          value: 'microSDXC',
        },
      ])
    );
  });

  it('does not emit a card slot when the capability is absent', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: { card_slot_type: 'CFexpress Type B' },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).not.toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Card Slot',
          value: 'CFexpress Type B',
        },
      ])
    );
  });

  it('emits a card-slot type when the capability is explicitly true', () => {
    const schema = generateProductSchema(
      makeSeoProduct({
        category: 'Cameras',
        product_key_specs: {
          card_slot_type: 'CFexpress Type B',
          has_card_slot: true,
        },
      }),
      'Ogabassey',
      'NGN',
      'NG'
    );

    expect(schema.additionalProperty).toEqual(
      expect.arrayContaining([
        {
          '@type': 'PropertyValue',
          name: 'Card Slot',
          value: 'CFexpress Type B',
        },
      ])
    );
  });

  it('does not fabricate card-slot values when the type is missing', () => {
    for (const cardSlotType of [undefined, null]) {
      const schema = generateProductSchema(
        makeSeoProduct({
          category: 'Cameras',
          product_key_specs: {
            has_card_slot: true,
            card_slot_type: cardSlotType as unknown as NonNullable<
              typeof cardSlotType
            >,
          },
        }),
        'Ogabassey',
        'NGN',
        'NG'
      );
      const names = (
        (schema.additionalProperty as Record<string, unknown>[] | undefined) ??
        []
      ).map((property) => property.name);

      expect(names).not.toContain('Card Slot');
    }
  });
});
