import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpecByLabel } from './product-schema-spec-label-inclusion';

describe('shouldIncludeProductSchemaSpecByLabel', () => {
  it('rejects unlabeled hardware keys when category data is absent', () => {
    for (const canonicalSpecKey of ['ram_gb', 'storage_gb', 'chipset']) {
      expect(
        shouldIncludeProductSchemaSpecByLabel({
          canonicalSpecKey,
          categoryNames: [],
          productFamily: 'general',
        })
      ).toBe(false);
    }
  });

  it('allows unlabeled specs by default outside accessory categories', () => {
    expect(
      shouldIncludeProductSchemaSpecByLabel({
        categoryNames: ['Cameras'],
        productFamily: 'camera',
      })
    ).toBe(true);
  });

  it('rejects unlabeled phone-shaped keys for accessory categories', () => {
    expect(
      shouldIncludeProductSchemaSpecByLabel({
        canonicalSpecKey: 'ram_gb',
        categoryNames: ['Phone Cases'],
        productFamily: 'general',
      })
    ).toBe(false);
  });

  it('allows non-phone labels through the legacy label path', () => {
    expect(
      shouldIncludeProductSchemaSpecByLabel({
        categoryNames: ['Cameras'],
        normalizedLabel: 'sensor',
        productFamily: 'camera',
      })
    ).toBe(true);
  });

  it('rejects phone-only labels that are not explicitly exempted', () => {
    for (const normalizedLabel of ['5g', 'nfc', 'sim type', 'android']) {
      expect(
        shouldIncludeProductSchemaSpecByLabel({
          categoryNames: ['Cameras'],
          normalizedLabel,
          productFamily: 'camera',
        })
      ).toBe(false);
    }
  });

  it('keeps card slot and OIS labels eligible for cross-family reuse', () => {
    for (const normalizedLabel of ['card slot', 'ois']) {
      expect(
        shouldIncludeProductSchemaSpecByLabel({
          categoryNames: ['Cameras'],
          normalizedLabel,
          productFamily: 'camera',
        })
      ).toBe(true);
    }
  });

  it('keeps operating-system labels eligible for non-phone products', () => {
    for (const normalizedLabel of ['operating system', 'os']) {
      expect(
        shouldIncludeProductSchemaSpecByLabel({
          categoryNames: ['Televisions'],
          normalizedLabel,
          productFamily: 'general',
        })
      ).toBe(true);
    }
  });

  it('keeps audio capability labels eligible outside phone categories', () => {
    for (const normalizedLabel of [
      'headphone jack',
      '3 5mm jack',
      'speakers',
      'loudspeaker',
    ]) {
      expect(
        shouldIncludeProductSchemaSpecByLabel({
          categoryNames: ['Audio'],
          normalizedLabel,
          productFamily: 'general',
        })
      ).toBe(true);
    }
  });
});
