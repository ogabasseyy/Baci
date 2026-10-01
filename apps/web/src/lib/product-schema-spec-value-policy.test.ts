import { describe, expect, it } from 'vitest';
import { getProductSchemaSpecValueDecision } from './product-schema-spec-value-policy';

describe('getProductSchemaSpecValueDecision', () => {
  it('excludes missing and invalid measurement values for every family', () => {
    for (const value of [undefined, null, 0, 'N/A', '0GB']) {
      expect(
        getProductSchemaSpecValueDecision({
          canonicalSpecKey: 'storage_gb',
          hasCategory: true,
          isExplicitSpecKey: true,
          isMobileCategory: true,
          isPhoneOnlyLabel: false,
          normalizedLabel: 'storage',
          value,
        })
      ).toBe('exclude');
    }
  });

  it('rejects composite measurements only when every component is nonpositive', () => {
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'dimensions_mm',
        hasCategory: true,
        isExplicitSpecKey: true,
        isMobileCategory: false,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'dimensions',
        value: '0 x 0 x 0 mm',
      })
    ).toBe('exclude');
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'dimensions_mm',
        hasCategory: true,
        isExplicitSpecKey: true,
        isMobileCategory: false,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'dimensions',
        value: '150 x -70 x 8 mm',
      })
    ).toBe('exclude');
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'display_resolution',
        hasCategory: true,
        isExplicitSpecKey: true,
        isMobileCategory: true,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'display resolution',
        value: '1920 x 0',
      })
    ).toBe('exclude');
  });

  it('keeps measurements with a valid value and an auxiliary zero endpoint', () => {
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'charging_watt',
        hasCategory: true,
        isExplicitSpecKey: true,
        isMobileCategory: true,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'fast charging',
        productFamily: 'mobile',
        value: '67W, 0-100% in 45 min',
      })
    ).toBe('defer');
  });

  it('preserves signed storage-temperature ranges as non-capacity facts', () => {
    expect(
      getProductSchemaSpecValueDecision({
        hasCategory: true,
        isExplicitSpecKey: false,
        isMobileCategory: false,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'storage temperature',
        productFamily: 'camera',
        value: '-20°C to 60°C',
      })
    ).toBe('defer');
  });

  it('keeps legitimate zero scalars on merchant-defined custom properties', () => {
    expect(
      getProductSchemaSpecValueDecision({
        hasCategory: true,
        isExplicitSpecKey: false,
        isMobileCategory: false,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'minimum operating temperature',
        value: 0,
      })
    ).toBe('defer');
  });

  it('includes explicit negative capabilities only for mobile families', () => {
    const input = {
      canonicalSpecKey: 'has_5g',
      isExplicitSpecKey: true,
      hasCategory: true,
      isPhoneOnlyLabel: true,
      normalizedLabel: '5g support',
      value: false,
    };

    expect(
      getProductSchemaSpecValueDecision({
        ...input,
        isMobileCategory: true,
      })
    ).toBe('include');
    expect(
      getProductSchemaSpecValueDecision({
        ...input,
        isMobileCategory: false,
      })
    ).toBe('exclude');
  });

  it('keeps explicit computer audio negatives without accepting camera capability negatives', () => {
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'has_headphone_jack',
        isExplicitSpecKey: true,
        hasCategory: true,
        isMobileCategory: false,
        isPhoneOnlyLabel: true,
        normalizedLabel: 'headphone jack',
        productFamily: 'computer',
        value: false,
      })
    ).toBe('include');
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'has_ois',
        isExplicitSpecKey: true,
        hasCategory: true,
        isMobileCategory: false,
        isPhoneOnlyLabel: true,
        normalizedLabel: 'ois',
        productFamily: 'camera',
        value: false,
      })
    ).toBe('exclude');
  });

  it('defers meaningful unrelated negative facts to category policy', () => {
    expect(
      getProductSchemaSpecValueDecision({
        hasCategory: true,
        isExplicitSpecKey: false,
        isMobileCategory: false,
        isPhoneOnlyLabel: false,
        normalizedLabel: 'weather sealing',
        value: 'No',
      })
    ).toBe('defer');
  });

  it('rejects truthy strings for boolean capabilities instead of treating them as verified', () => {
    for (const value of ['Yes', 'Unknown', 'Not specified']) {
      expect(
        getProductSchemaSpecValueDecision({
          canonicalSpecKey: 'has_nfc',
          isExplicitSpecKey: true,
          hasCategory: true,
          isMobileCategory: true,
          isPhoneOnlyLabel: true,
          normalizedLabel: 'nfc',
          productFamily: 'mobile',
          value,
        })
      ).toBe('exclude');
    }
  });

  it('rejects non-boolean values for keyed capabilities', () => {
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'has_nfc',
        isExplicitSpecKey: true,
        hasCategory: true,
        isMobileCategory: true,
        isPhoneOnlyLabel: true,
        normalizedLabel: 'nfc',
        productFamily: 'mobile',
        value: 1,
      })
    ).toBe('exclude');
  });

  it('keeps a supported card-slot type as a factual specification', () => {
    expect(
      getProductSchemaSpecValueDecision({
        canonicalSpecKey: 'card_slot_type',
        hasCategory: true,
        isExplicitSpecKey: true,
        isMobileCategory: false,
        isPhoneOnlyLabel: true,
        normalizedLabel: 'card slot',
        productFamily: 'camera',
        value: 'CFexpress Type B / SD UHS-II',
      })
    ).toBe('defer');
  });
});
