import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec', () => {
  it('rejects phone-only negative fields for the supported camera categories', () => {
    const cameraCategories = [
      'Cameras',
      'Action Cameras',
      'Instant Cameras',
      'Lenses',
      'Drones',
      'Gimbals',
      'Microphones',
      'Monitors & Transmitters',
      'Tripod Stands',
      'Camera Accessories',
      'Instant Film',
      'Memory Cards',
    ];

    for (const category of cameraCategories) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { key: 'has_5g', value: false }
        )
      ).toBe(false);
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'Card Slot', value: 'No' }
        )
      ).toBe(false);
    }
  });

  it('uses the relation-backed category and retains verified camera values', () => {
    const product = {
      category: 'Smartphones',
      categories: { name: 'Action Cameras' },
    };

    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'has_nfc',
        value: false,
      })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        label: 'Card Slot',
        value: 'CFexpress Type B / SD UHS-II',
      })
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'card_slot_type',
        value: 'CFexpress Type B / SD UHS-II',
      })
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        label: 'Sensor',
        value: '45MP full-frame CMOS',
      })
    ).toBe(true);
  });

  it('uses the joined category before a stale legacy category', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Electronics', categories: { name: 'Smartphones' } },
        { key: 'has_5g', value: true }
      )
    ).toBe(true);
  });

  it('preserves negative mapping behavior for phone and tablet categories', () => {
    for (const category of ['Smartphones', 'Tablets']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { key: 'has_5g', value: false }
        )
      ).toBe(true);
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'Card Slot', value: 'No' }
        )
      ).toBe(true);
    }
  });

  it('retains positive audio capabilities for named non-phone products', () => {
    for (const category of ['Audio', 'Gaming']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'Speakers', value: 'Stereo' }
        )
      ).toBe(true);
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { key: 'has_headphone_jack', value: true }
        )
      ).toBe(true);
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'Headphone Jack', value: 'No' }
        )
      ).toBe(false);
    }
  });

  it('retains verified audio capabilities for camera products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'has_stereo_speakers', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'has_headphone_jack', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { key: 'has_headphone_jack', value: false }
      )
    ).toBe(false);
  });

  it('retains positive NFC for audio products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Bluetooth Speakers', categories: null },
        { key: 'has_nfc', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Headphones', categories: null },
        { label: 'NFC', value: 'Yes' }
      )
    ).toBe(true);
  });

  it('filters phone-only negative fields for other named non-phone categories', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Audio', categories: null },
        { key: 'has_nfc', value: false }
      )
    ).toBe(false);
  });

  it('does not classify device accessory categories as phone families', () => {
    for (const category of [
      'Phone Accessories',
      'Smartphone Cases',
      'Laptop Keyboard',
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { key: 'has_5g', value: false }
        )
      ).toBe(false);
    }
  });

  it('rejects stale keyed device specs for accessory categories', () => {
    for (const key of ['ram_gb', 'storage_gb', 'chipset']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Phone Cases', categories: null },
          { key, value: key === 'chipset' ? 'Snapdragon 8 Gen 3' : 256 }
        )
      ).toBe(false);
    }
  });

  it('retains verified fingerprint readers for computer products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Laptops', categories: null },
        { key: 'fingerprint_type', value: 'Power button' }
      )
    ).toBe(true);
  });

  it('rejects positive phone-only fields on consoles and other non-phone products', () => {
    for (const candidate of [
      { key: 'has_5g', value: true },
      { key: 'android_version', value: '16' },
      { key: 'sim_type', value: 'Nano-SIM' },
      { key: 'has_nfc', value: true },
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'PlayStation 5', categories: null },
          candidate
        )
      ).toBe(false);
    }
  });

  it('keeps smartphone-family categories eligible for phone-only schema fields', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Google Pixel', categories: null },
        { key: 'has_5g', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Smartwatches', categories: null },
        { key: 'has_nfc', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'iPhones', categories: null },
        { key: 'has_5g', value: true }
      )
    ).toBe(true);
  });

  it('drops unverified negative stabilization claims from non-phone schemas', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'OIS', value: 'No' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'OIS', value: '5-axis in-body stabilization' }
      )
    ).toBe(true);
  });

  it('keeps legitimate operating systems while dropping unsupported placeholders', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Televisions', categories: null },
        { label: 'Operating System', value: 'webOS 25' }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Gaming', categories: null },
        { label: 'OS', value: 'Orbis OS' }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Televisions', categories: null },
        { label: 'Operating System', value: 'N/A' }
      )
    ).toBe(false);
  });

  it('retains supported camera firmware labels without accepting placeholders', () => {
    for (const category of ['Drones', 'Gimbals']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'Operating System', value: 'DJI firmware 2.1' }
        )
      ).toBe(true);
      expect(
        shouldIncludeProductSchemaSpec(
          { category, categories: null },
          { label: 'OS', value: 'N/A' }
        )
      ).toBe(false);
    }

    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Drones', categories: null },
        { key: 'android_version', label: 'Operating System', value: '16' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Drones', categories: null },
        { label: 'Operating System', value: 'Android 16' }
      )
    ).toBe(false);
  });
});
