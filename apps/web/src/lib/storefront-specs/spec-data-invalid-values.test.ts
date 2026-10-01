import { describe, expect, it } from 'vitest';
import { buildProductSpecData } from './spec-data';

describe('buildProductSpecData invalid values', () => {
  it('removes zero and placeholder measurements from mobile and computer specs', () => {
    for (const category of ['Smartphones', 'Laptops']) {
      const result = buildProductSpecData({
        category,
        product_key_specs: {
          storage_gb: 0,
          battery_mah: 0,
          display_resolution: 'Unknown',
        },
        specifications: [
          {
            category: 'Measurements',
            items: [
              { label: 'Screen Size', value: '0 inches' },
              { label: 'Display Resolution', value: 'Unknown' },
            ],
          },
        ],
      });
      const values = result.detailedSpecs.flatMap((section) =>
        section.items.map((item) => item.value)
      );

      for (const prohibitedValue of ['0GB', '0mAh', '0 inches', 'Unknown']) {
        expect(values).not.toContain(prohibitedValue);
      }
    }
  });
});
