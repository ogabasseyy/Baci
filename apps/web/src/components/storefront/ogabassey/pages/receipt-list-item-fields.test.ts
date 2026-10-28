import { describe, expect, it } from 'vitest';
import {
  getAdditionalDeviceCount,
  getOptionalReceiptItemNumber,
  getReceiptItemDisplayName,
  getReceiptItemImage,
  getReceiptItemName,
  getReceiptItemQuantity,
  getReceiptItemVariantName,
  getReceiptListItemStringValue,
} from './receipt-list-item-fields';

describe('receipt-list-item-fields', () => {
  it('trims strings and treats blanks as absent', () => {
    expect(getReceiptListItemStringValue('  Phone ')).toBe('Phone');
    expect(getReceiptListItemStringValue('   ')).toBeNull();
    expect(getReceiptListItemStringValue(null)).toBeNull();
    expect(getReceiptListItemStringValue(42)).toBeNull();
  });

  it('falls back through product name aliases to Unknown item', () => {
    expect(getReceiptItemName({ product_name: 'Fold' })).toBe('Fold');
    expect(getReceiptItemName({ name: 'S26' })).toBe('S26');
    expect(getReceiptItemName({})).toBe('Unknown item');
    expect(getReceiptItemName(undefined)).toBe('Unknown item');
  });

  it('prefers snapshot images over joined product images', () => {
    expect(getReceiptItemImage({ image_url: 'snap.png' })).toBe('snap.png');
    expect(
      getReceiptItemImage({ product_images: ['joined.png'] })
    ).toBe('joined.png');
    expect(getReceiptItemImage(undefined)).toBeNull();
  });

  it('labels variants and conditions without duplicating the base name', () => {
    expect(
      getReceiptItemVariantName({ variant_name: 'Titan Black' })
    ).toBe('Titan Black');
    expect(
      getReceiptItemDisplayName({
        name: 'S26 (Titan Black)',
        variant_name: 'Titan Black',
      })
    ).toBe('S26 (Titan Black)');
    expect(
      getReceiptItemDisplayName({ name: 'S26', variant_name: 'Titan Black' })
    ).toBe('S26 (Titan Black)');
  });

  it('clamps invalid quantities to one', () => {
    expect(getReceiptItemQuantity({ quantity: 2 })).toBe(2);
    expect(getReceiptItemQuantity({ quantity: 0 })).toBe(1);
    expect(getReceiptItemQuantity({ quantity: 'x' })).toBe(1);
    expect(getReceiptItemQuantity({})).toBe(1);
  });

  it('leaves invalid optional numbers absent instead of coercing to zero', () => {
    expect(
      getOptionalReceiptItemNumber({ line_extension_amount: 90 }, 'line_extension_amount')
    ).toBe(90);
    expect(
      getOptionalReceiptItemNumber({ line_extension_amount: '90' }, 'line_extension_amount')
    ).toBe(90);
    expect(
      getOptionalReceiptItemNumber({ line_extension_amount: null }, 'line_extension_amount')
    ).toBeUndefined();
    expect(
      getOptionalReceiptItemNumber({ line_extension_amount: 'x' }, 'line_extension_amount')
    ).toBeUndefined();
    expect(getOptionalReceiptItemNumber({}, 'vat_rate')).toBeUndefined();
  });

  it('counts additional devices beyond the first', () => {
    expect(getAdditionalDeviceCount([{ quantity: 2 }, { quantity: 1 }])).toBe(
      2
    );
    expect(getAdditionalDeviceCount([{ quantity: 1 }])).toBe(0);
  });
});
