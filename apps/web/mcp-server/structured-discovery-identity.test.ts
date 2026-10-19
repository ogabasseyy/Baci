import { describe, expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';

type DiscoveryAlternative = McpDiscoveryIntent['alternatives'][number];

function productOf(overrides: Record<string, unknown> = {}) {
  return {
    brand: 'Samsung',
    category: 'smartphones',
    discovery_metadata: {
      product_type: 'phone',
      model: 'Galaxy S25',
      compatible_with: ['Galaxy Buds'],
    },
    ...overrides,
  };
}

function verdictOf(
  product: Record<string, unknown>,
  alternative: DiscoveryAlternative,
  intent: McpDiscoveryIntent = { alternatives: [alternative] }
) {
  const discovery = structuredDiscoveryIdentity.metadataOf(product);
  return structuredDiscoveryIdentity.evaluateAlternativeIdentity(
    product,
    discovery,
    alternative,
    structuredDiscoveryIdentity.excludedTypesOf(intent),
    structuredDiscoveryIdentity.productTypeOf(product, discovery)
  );
}

describe('structuredDiscoveryIdentity.normalizeText', () => {
  it('folds case and whitespace with NFC normalization', () => {
    expect(structuredDiscoveryIdentity.normalizeText('  Galaxy   S25 ')).toBe(
      'galaxy s25'
    );
    expect(
      structuredDiscoveryIdentity.normalizeText('café')
    ).toBe(structuredDiscoveryIdentity.normalizeText('café'));
  });

  it('rejects non-strings and blanks', () => {
    expect(structuredDiscoveryIdentity.normalizeText(42)).toBeUndefined();
    expect(structuredDiscoveryIdentity.normalizeText('   ')).toBeUndefined();
  });

  it('folds ASCII only so SQL translate() agrees on contextual casing', () => {
    expect(structuredDiscoveryIdentity.normalizeText('ΟΣ')).toBe('ΟΣ');
    expect(structuredDiscoveryIdentity.normalizeText('İI')).toBe('İi');
  });
});

describe('structuredDiscoveryIdentity.productTypeOf', () => {
  it('canonicalizes hyphenated stored types like the schema', () => {
    const product = productOf({
      discovery_metadata: { product_type: 'security-camera' },
    });
    const discovery = structuredDiscoveryIdentity.metadataOf(product);
    expect(
      structuredDiscoveryIdentity.productTypeOf(product, discovery)
    ).toBe('security_camera');
  });

  it('falls back to category for phones, laptops, and tablets', () => {
    for (const [category, expected] of [
      ['smartphones', 'phone'],
      ['laptops', 'laptop'],
      ['tablets', 'tablet'],
    ]) {
      const product = productOf({ category, discovery_metadata: {} });
      const discovery = structuredDiscoveryIdentity.metadataOf(product);
      expect(
        structuredDiscoveryIdentity.productTypeOf(product, discovery)
      ).toBe(expected);
    }
  });

  it('returns undefined without a type or known category', () => {
    const product = productOf({ category: 'grocery', discovery_metadata: {} });
    const discovery = structuredDiscoveryIdentity.metadataOf(product);
    expect(
      structuredDiscoveryIdentity.productTypeOf(product, discovery)
    ).toBeUndefined();
  });
});

describe('structuredDiscoveryIdentity.evaluateAlternativeIdentity', () => {
  it('matches a stored model with or without its verified manufacturer prefix', () => {
    const tecno = productOf({
      brand: 'Tecno',
      discovery_metadata: { model: 'TECNO SPARK 50', product_type: 'phone' },
    });
    expect(verdictOf(tecno, { brands: ['Tecno'], model: 'Spark 50' })).toEqual({
      excluded: false,
      unverified: false,
    });
    expect(
      verdictOf(productOf(), {
        brands: ['Samsung'],
        model: 'Samsung Galaxy S25',
      }).excluded
    ).toBe(false);
    for (const model of [
      'Spark 50 5G',
      'Spark 50 Pro',
      'Spark 5',
      'Samsung Spark 50',
    ]) {
      expect(verdictOf(tecno, { model }).excluded).toBe(true);
    }
    expect(
      verdictOf({ ...tecno, brand: null }, { model: 'Spark 50' }).excluded
    ).toBe(true);
  });

  it('matches a fully verified alternative', () => {
    expect(
      verdictOf(productOf(), {
        product_type: 'phone',
        brands: ['samsung'],
        model: 'galaxy s25',
        compatible_with: 'galaxy buds',
      })
    ).toEqual({ excluded: false, unverified: false });
  });

  it('excludes type, brand, model, and compatibility mismatches', () => {
    expect(
      verdictOf(productOf(), { product_type: 'laptop' }).excluded
    ).toBe(true);
    expect(verdictOf(productOf(), { brands: ['Apple'] }).excluded).toBe(true);
    expect(
      verdictOf(productOf(), { model: 'iPhone 16' }).excluded
    ).toBe(true);
    expect(
      verdictOf(productOf(), { compatible_with: 'AirPods' }).excluded
    ).toBe(true);
  });

  it('marks missing product facts unverified instead of excluding', () => {
    const bare = productOf({
      brand: null,
      category: 'grocery',
      discovery_metadata: {},
    });
    expect(
      verdictOf(bare, {
        product_type: 'phone',
        brands: ['Samsung'],
        model: 'Galaxy S25',
        compatible_with: 'Galaxy Buds',
      })
    ).toEqual({ excluded: false, unverified: true });
  });

  it('excludes blank constraints and excluded product types', () => {
    expect(verdictOf(productOf(), { product_type: '   ' })).toEqual({
      excluded: true,
      unverified: false,
    });
    expect(
      verdictOf(productOf(), {}, {
        alternatives: [{}],
        excluded_product_types: ['phone'],
      })
    ).toEqual({ excluded: true, unverified: false });
  });

  it('marks unknown types unverified when exclusions exist', () => {
    const untyped = productOf({ category: 'grocery', discovery_metadata: {} });
    expect(
      verdictOf(untyped, {}, {
        alternatives: [{}],
        excluded_product_types: ['laptop'],
      })
    ).toEqual({ excluded: false, unverified: true });
  });
});

describe('structuredDiscoveryIdentity.isRowExcludedByIdentity', () => {
  it('requires every alternative to be excluded', () => {
    const row = { product: productOf() } as Parameters<
      typeof structuredDiscoveryIdentity.isRowExcludedByIdentity
    >[0];
    expect(
      structuredDiscoveryIdentity.isRowExcludedByIdentity(row, {
        alternatives: [{ product_type: 'laptop' }, { brands: ['Apple'] }],
      })
    ).toBe(true);
    expect(
      structuredDiscoveryIdentity.isRowExcludedByIdentity(row, {
        alternatives: [{ product_type: 'laptop' }, { brands: ['Samsung'] }],
      })
    ).toBe(false);
  });
});

describe('structuredDiscoveryIdentity.variantsOwnConditionAxis', () => {
  it('is true when any variant carries a normalized condition', () => {
    expect(
      structuredDiscoveryIdentity.variantsOwnConditionAxis(
        { has_variants: true },
        [{ condition: null }, { condition: 'new' }]
      )
    ).toBe(true);
  });

  it('is false without variants, flags, or conditions', () => {
    expect(
      structuredDiscoveryIdentity.variantsOwnConditionAxis(
        { has_variants: true },
        [{ condition: null }, 'broken', null]
      )
    ).toBe(false);
    expect(
      structuredDiscoveryIdentity.variantsOwnConditionAxis(
        { has_variants: false },
        [{ condition: 'new' }]
      )
    ).toBe(false);
    expect(
      structuredDiscoveryIdentity.variantsOwnConditionAxis(
        { has_variants: true },
        undefined
      )
    ).toBe(false);
  });
});
