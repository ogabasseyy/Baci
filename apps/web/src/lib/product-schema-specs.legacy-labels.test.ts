import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec legacy labels', () => {
  it('rejects phone and camera labels outside mobile and camera families', () => {
    for (const candidate of [
      { label: 'Main Camera', value: '50MP' },
      { label: 'Selfie Camera', value: '16MP' },
      { label: 'Network Technology', value: '5G' },
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Gaming', categories: null },
          candidate
        )
      ).toBe(false);
    }

    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Main Camera', value: '50MP' }
      )
    ).toBe(true);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Smartphones', categories: null },
        { label: 'Main Camera', value: '50MP' }
      )
    ).toBe(true);
  });

  it('rejects dynamic camera labels outside camera and mobile families', () => {
    for (const label of [
      'Quad Camera',
      'Triple Camera',
      'Dual Camera',
      'Single Camera',
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Gaming', categories: null },
          { label, value: '50MP' }
        )
      ).toBe(false);
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Cameras', categories: null },
          { label, value: '50MP' }
        )
      ).toBe(true);
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Smartphones', categories: null },
          { label, value: '50MP' }
        )
      ).toBe(true);
    }
  });

  it('rejects phone-only reverse charging rows for camera categories', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Cameras', categories: null },
        { label: 'Reverse Charging', value: 'Yes' }
      )
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Smartphones', categories: null },
        { label: 'Reverse Charging', value: 'Yes' }
      )
    ).toBe(true);
  });
});
