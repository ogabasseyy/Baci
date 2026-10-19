import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec non-phone capabilities', () => {
  it('preserves meaningful negative facts that are unrelated to stale phone capabilities', () => {
    for (const candidate of [
      { label: 'Weather Sealing', value: 'No' },
      { label: 'Requires Assembly', value: false },
      { label: 'Built-in Flash', value: 'No' },
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cameras', categories: null },
          candidate
        )
      ).toBe(true);
    }

    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'NFC', value: 'No' }
      )
    ).toBe(false);
  });

  it('preserves verified positive NFC for camera hardware without enabling it for unrelated families', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Action Cameras', categories: null },
        { key: 'has_nfc', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Action Cameras', categories: null },
        { key: 'has_nfc', value: false }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'PlayStation 5', categories: null },
        { key: 'has_nfc', value: true }
      )
    ).toBe(false);
  });

  it('preserves descriptive radio rows for radio products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Car Stereo', categories: null },
        { label: 'Radio', value: 'FM / AM' }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Car Stereo', categories: null },
        { key: 'has_fm_radio', value: true }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Radio', value: 'FM / AM' }
      )
    ).toBe(false);
  });

  it('preserves verified NFC for soundbar products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Soundbars', categories: null },
        { key: 'has_nfc', value: true }
      )
    ).toBe(true);
  });

  it('rejects stale positive legacy rows when authoritative capabilities are false', () => {
    const product = {
      category: 'Cameras',
      categories: null,
      product_key_specs: {
        has_ois: false,
        has_wireless_charging: false,
      },
    };

    expect(
      shouldIncludeProductSchemaSpec(product, { label: 'OIS', value: 'Yes' })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        label: 'Wireless Charging',
        value: '15W',
      })
    ).toBe(false);
  });

  it('preserves explicit false keyed capabilities on mobile products', () => {
    const product = {
      category: 'Smartphones',
      categories: null,
      product_key_specs: { has_5g: false },
    };

    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'has_5g',
        value: false,
      })
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'has_headphone_jack',
        value: false,
      })
    ).toBe(true);
  });

  it('retains keyed android_version for smart TV products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Smart TVs', categories: null },
        { key: 'android_version', value: '14' }
      )
    ).toBe(true);
  });

  it('rejects legacy Android Version rows on non-phone products', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Android Version', value: '12' }
      )
    ).toBe(false);
  });
});
