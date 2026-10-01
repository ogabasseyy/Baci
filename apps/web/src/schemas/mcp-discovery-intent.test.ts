import { describe, expect, it } from 'vitest';
import { mcpDiscoveryIntentSchema } from './mcp-discovery-intent';
import { productDiscoveryMetadataSchema } from './product-discovery-metadata';

describe('mcpDiscoveryIntentSchema', () => {
  it('accepts numeric specification comparisons and text equality alternatives', () => {
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [
          {
            product_type: 'Laptop',
            attributes: [
              { key: 'ram_gb', operator: 'gte', value: 16 },
              { key: 'storage_gb', operator: 'eq', value: 512 },
              { key: 'color', operator: 'eq', value: 'Black' },
            ],
          },
          { brands: ['Lenovo', 'HP'], model: 'ThinkPad X1' },
        ],
        excluded_product_types: ['Desktop'],
      }).success
    ).toBe(true);
  });

  it('uses metadata product type canonicalization for alternatives and exclusions', () => {
    const parsed = mcpDiscoveryIntentSchema.parse({
      alternatives: [
        { product_type: 'Smartphones' },
        { product_type: 'Security Camera' },
      ],
      excluded_product_types: ['Phones', 'Laptop'],
    });
    expect(
      parsed.alternatives.map((alternative) => alternative.product_type)
    ).toEqual(['phone', 'security_camera']);
    expect(parsed.excluded_product_types).toEqual(['phone', 'laptop']);
    const metadata = productDiscoveryMetadataSchema.parse({
      product_type: 'Smartphones',
    });
    expect(parsed.alternatives[0]?.product_type).toBe(metadata.product_type);
  });

  it('canonicalizes symmetric phone aliases for product types and exclusions', () => {
    for (const alias of [
      'smart_phone',
      'smart_phones',
      'mobile_phone',
      'mobile_phones',
      'cell_phone',
      'cell_phones',
    ]) {
      const parsed = mcpDiscoveryIntentSchema.parse({
        alternatives: [{ product_type: alias }],
        excluded_product_types: [alias],
      });
      expect(parsed.alternatives[0]?.product_type).toBe('phone');
      expect(parsed.excluded_product_types).toEqual(['phone']);
    }
  });

  it('rejects incorrect value types and text comparison operators', () => {
    for (const attribute of [
      { key: 'ram_gb', operator: 'eq', value: '16' },
      { key: 'color', operator: 'gte', value: 'Black' },
      { key: 'power_w', operator: 'lte', value: -1 },
      { key: 'refresh_hz', operator: 'eq', value: Number.NaN },
      { key: 'processor', operator: 'eq', value: Number.POSITIVE_INFINITY },
    ]) {
      expect(
        mcpDiscoveryIntentSchema.safeParse({
          alternatives: [{ attributes: [attribute] }],
        }).success
      ).toBe(false);
    }
  });

  it('rejects numeric magnitudes retrieval cannot expand within the query gate', () => {
    for (const value of [Number.MAX_VALUE, 1e12, 1e-7, Number.MIN_VALUE]) {
      const parsed = mcpDiscoveryIntentSchema.safeParse({
        alternatives: [
          { attributes: [{ key: 'storage_gb', operator: 'eq', value }] },
        ],
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toContainEqual(
          expect.objectContaining({
            message: 'Numeric specifications must use realistic magnitudes',
          })
        );
      }
    }
    for (const value of [0, 1e-6, 256, 1_000_000_000]) {
      expect(
        mcpDiscoveryIntentSchema.safeParse({
          alternatives: [
            { attributes: [{ key: 'storage_gb', operator: 'eq', value }] },
          ],
        }).success
      ).toBe(true);
    }
  });

  it('enforces alternative, attribute, and unknown-field contracts', () => {
    expect(
      mcpDiscoveryIntentSchema.safeParse({ alternatives: [] }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({ alternatives: [{}] }).success
    ).toBe(true);
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [{}, { product_type: 'phone' }],
      }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: Array.from({ length: 6 }, () => ({})),
      }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [
          {
            attributes: Array.from({ length: 11 }, () => ({
              key: 'ram_gb',
              operator: 'gte',
              value: 4,
            })),
          },
        ],
      }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [{}],
        extra: 'not allowed',
      }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [{ merchant_id: 'tenant' }],
      }).success
    ).toBe(false);
  });
});

describe('text length alignment with the published card schema', () => {
  it.each([
    { label: 'BMP', char: 'a' },
    { label: 'astral', char: '😀' },
  ])('measures $label text in code points like Draft-07 maxLength', ({
    char,
  }) => {
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [{ model: char.repeat(100) }],
      }).success
    ).toBe(true);
    const over = mcpDiscoveryIntentSchema.safeParse({
      alternatives: [{ model: char.repeat(101) }],
    });
    expect(over.success).toBe(false);
  });
});

describe('semantic alternative constraints', () => {
  it.each([
    { attributes: [] },
    { model: undefined },
  ])('rejects a semantically empty branch mixed with constraints: %s', (emptyBranch) => {
    expect(
      mcpDiscoveryIntentSchema.safeParse({
        alternatives: [emptyBranch, { product_type: 'phone' }],
      }).success
    ).toBe(false);
    expect(
      mcpDiscoveryIntentSchema.safeParse({ alternatives: [emptyBranch] })
        .success
    ).toBe(true);
  });
});
