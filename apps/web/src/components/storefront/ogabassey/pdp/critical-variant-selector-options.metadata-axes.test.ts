import { describe, expect, it } from 'vitest';
import {
  getAvailableCriticalVariantOptions,
  getRenderableCriticalVariantAxes,
} from './critical-variant-selector-options';

describe('critical variant selector metadata axes', () => {
  it('filters out non-variant metadata axes while preserving legitimate SKU dimensions', () => {
    const rawAxes = [
      'storage',
      'notebook_size',
      'extended_warranty',
      'availability_note',
      'warranty',
      'warranty_note',
      'disclaimer',
      'delivery_notice',
    ];
    const testVariants = [
      {
        attributes: {
          availability_note: 'Confirm price',
          delivery_notice: 'Ships fast',
          disclaimer: 'Final sale',
          extended_warranty: '2 Years',
          notebook_size: '16 inch',
          storage: '2TB',
          warranty: '1 Year',
          warranty_note: 'Parts only',
        },
        id: 'v1',
        merchant_id: 'm1',
        product_id: 'p1',
        stock_quantity: 10,
      },
    ];
    const variantAxisOptions = {
      availability_note: ['Confirm price'],
      delivery_notice: ['Ships fast'],
      disclaimer: ['Final sale'],
      extended_warranty: ['2 Years'],
      notebook_size: ['16 inch'],
      storage: ['2TB'],
      warranty: ['1 Year'],
      warranty_note: ['Parts only'],
    };

    const renderableVariantAxes = getRenderableCriticalVariantAxes(
      rawAxes,
      testVariants,
      variantAxisOptions
    );

    expect(renderableVariantAxes).toEqual([]);
    expect(renderableVariantAxes).not.toContain('availability_note');
    expect(renderableVariantAxes).not.toContain('warranty');
    expect(renderableVariantAxes).not.toContain('warranty_note');
    expect(renderableVariantAxes).not.toContain('disclaimer');
    expect(renderableVariantAxes).not.toContain('delivery_notice');
  });

  it('renders critical warranty axis as selectable when multiple warranty options exist', () => {
    const rawAxes = ['storage', 'warranty'];
    const testVariants = [
      { attributes: { storage: '2TB', warranty: '1 Year' }, id: 'v1', merchant_id: 'm1', product_id: 'p1', stock_quantity: 10 },
      { attributes: { storage: '2TB', warranty: '2 Years' }, id: 'v2', merchant_id: 'm1', product_id: 'p1', stock_quantity: 5 },
    ];

    const renderableVariantAxes = getRenderableCriticalVariantAxes(rawAxes, testVariants, {});

    expect(renderableVariantAxes).toEqual(['warranty']);
  });

  it('excludes canonicalized availability note aliases from availability constraints', () => {
    const variants = [
      {
        attributes: { storage: '128GB', availability_note: 'A' },
        id: 'variant-128',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 2,
      },
      {
        attributes: { storage: '256GB', availability_note: 'B' },
        id: 'variant-256',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 2,
      },
    ];

    const options = getAvailableCriticalVariantOptions(
      'storage',
      variants,
      { 'Availability note': 'A', storage: '128GB' }
    );

    expect(options).toEqual(['128GB', '256GB']);
  });
});
