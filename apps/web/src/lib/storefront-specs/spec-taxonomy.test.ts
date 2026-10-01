import { describe, expect, it } from 'vitest';
import {
  type ComparableProductKeySpecs,
  getProductSpecFamily,
  KEY_SPEC_CATEGORIES,
  SUMMARY_SPEC_PRIORITIES,
} from './spec-taxonomy';

function getField(categoryName: string, key: string) {
  const field = KEY_SPEC_CATEGORIES.find(
    (category) => category.category === categoryName
  )?.fields.find((candidate) => candidate.key === key);

  if (!field) {
    throw new Error(`Missing field ${categoryName}.${key}`);
  }

  return field;
}

function buildUntrustedCameraFlagSpecs(key: string, value: string) {
  const specs: ComparableProductKeySpecs = {};
  specs[key] = value;
  return specs;
}

describe('spec taxonomy', () => {
  it('classifies camera families separately from mobile devices', () => {
    expect(getProductSpecFamily('Cameras')).toBe('camera');
    expect(getProductSpecFamily('Action Cameras')).toBe('camera');
    expect(getProductSpecFamily('Instant Cameras')).toBe('camera');
    expect(getProductSpecFamily('Lenses')).toBe('general');
    expect(getProductSpecFamily('Drones')).toBe('camera');
    expect(getProductSpecFamily('Gimbals')).toBe('camera');
    expect(getProductSpecFamily('Camera Accessories')).toBe('general');
    expect(getProductSpecFamily('instant-film')).toBe('general');
    expect(getProductSpecFamily('memory-cards')).toBe('general');
    expect(getProductSpecFamily('Smartphones')).toBe('mobile');
    expect(getProductSpecFamily('iPhones')).toBe('mobile');
    expect(getProductSpecFamily('iPad')).toBe('mobile');
    expect(getProductSpecFamily('Apple Watch')).toBe('mobile');
    expect(getProductSpecFamily('Laptops')).toBe('computer');
    expect(getProductSpecFamily('Accessories')).toBe('general');
    expect(getProductSpecFamily('Smartphone Cases')).toBe('general');
    expect(getProductSpecFamily('Laptop Keyboard')).toBe('general');
  });

  it('formats common unit-bearing fields', () => {
    expect(getField('Display', 'screen_size_inches').transform?.(6.8, {})).toBe(
      '6.8 inches'
    );
    expect(getField('Body', 'weight_g').transform?.(221, {})).toBe('221g');
    expect(getField('Memory', 'storage_gb').transform?.(256, {})).toBe('256GB');
    expect(getField('Battery', 'battery_mah').transform?.(5000, {})).toBe(
      '5000mAh'
    );
    expect(
      getField('Battery', 'battery_mah').transform?.(5000, {
        battery_removable: true,
      })
    ).toBe('5000mAh (removable)');
    expect(getField('Battery', 'charging_watt').transform?.(65, {})).toBe(
      '65W'
    );
    expect(
      getField('Battery', 'wireless_charging_watt').transform?.(15, {})
    ).toBe('15W');
  });

  it('uses dynamic main-camera labels from camera count flags', () => {
    const field = getField('Main Camera', 'main_camera_mp');
    const cases: [ComparableProductKeySpecs, string][] = [
      [{ has_quad_camera: true }, 'Quad Camera'],
      [{ has_triple_camera: true }, 'Triple Camera'],
      [{ has_dual_camera: true }, 'Dual Camera'],
      [
        buildUntrustedCameraFlagSpecs('has_quad_camera', 'Unknown'),
        'Single Camera',
      ],
      [
        buildUntrustedCameraFlagSpecs('has_triple_camera', 'false'),
        'Single Camera',
      ],
      [
        buildUntrustedCameraFlagSpecs('has_dual_camera', 'true'),
        'Single Camera',
      ],
      [{}, 'Single Camera'],
    ];

    for (const [specs, expectedLabel] of cases) {
      expect(field.dynamicLabel?.(specs)).toBe(expectedLabel);
    }
  });

  it('gates conditional battery fields with their source booleans', () => {
    expect(
      getField('Battery', 'wireless_charging_watt').condition?.({
        has_wireless_charging: true,
      })
    ).toBe(true);
    expect(
      getField('Battery', 'wireless_charging_watt').condition?.({
        has_wireless_charging: false,
      })
    ).toBe(false);
    expect(
      getField('Battery', 'has_reverse_charging').condition?.({
        has_reverse_charging: true,
      })
    ).toBe(true);
    expect(getField('Battery', 'has_reverse_charging').condition?.({})).toBe(
      false
    );
  });

  it('keeps summary spec priority candidates stable', () => {
    expect(SUMMARY_SPEC_PRIORITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Display',
          candidates: expect.arrayContaining([['Display', 'Size']]),
        }),
        expect.objectContaining({
          label: 'Processor',
          candidates: expect.arrayContaining([['Platform', 'Chipset']]),
        }),
        expect.objectContaining({
          label: 'Camera',
          candidates: expect.arrayContaining([['Main Camera', 'Quad Camera']]),
        }),
        expect.objectContaining({
          label: 'Battery',
          candidates: expect.arrayContaining([['Battery', 'Capacity']]),
        }),
        expect.objectContaining({
          label: 'Storage',
          candidates: expect.arrayContaining([['Storage', 'Internal Storage']]),
        }),
      ])
    );
  });
});
