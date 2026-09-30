import { describe, expect, it } from 'vitest';
import { mcpDiscoveryIntentSchema } from './mcp-discovery-intent';

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

  it('enforces alternative, attribute, and unknown-field contracts', () => {
    expect(
      mcpDiscoveryIntentSchema.safeParse({ alternatives: [] }).success
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
