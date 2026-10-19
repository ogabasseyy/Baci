import { describe, expect, it } from 'vitest';
import { SEARCH_PRODUCTS_INTENT_SCHEMA } from './mcp-server-card-intent-schema';

describe('SEARCH_PRODUCTS_INTENT_SCHEMA', () => {
  it('requires at least one alternative with a bounded shape', () => {
    expect(SEARCH_PRODUCTS_INTENT_SCHEMA).toMatchObject({
      type: 'object',
      required: ['alternatives'],
      additionalProperties: false,
    });
    expect(SEARCH_PRODUCTS_INTENT_SCHEMA.properties.alternatives).toMatchObject(
      { type: 'array', minItems: 1, maxItems: 5 }
    );
  });

  it('splits attributes into numeric and text branches like the runtime schema', () => {
    const branches =
      SEARCH_PRODUCTS_INTENT_SCHEMA.properties.alternatives.items.properties
        .attributes.items.oneOf;
    expect(branches).toHaveLength(2);
    const [numeric, text] = branches;
    expect(numeric.properties.key.enum).toEqual(
      expect.arrayContaining(['storage_gb', 'ram_gb', 'power_w'])
    );
    expect(numeric.properties.operator.enum).toEqual(['eq', 'gte', 'lte']);
    expect(numeric.properties.value).toMatchObject({
      anyOf: [
        { const: 0 },
        { type: 'number', minimum: 0.000001, maximum: 1000000000 },
      ],
    });
    expect(text.properties.key.enum).toEqual(
      expect.arrayContaining(['color', 'connectivity'])
    );
    expect(text.properties.operator.enum).toEqual(['eq']);
    expect(text.properties.value).toMatchObject({ type: 'string' });
  });

  it('rejects whitespace-only text like the trimmed runtime schema', () => {
    const alternative =
      SEARCH_PRODUCTS_INTENT_SCHEMA.properties.alternatives.items.properties;
    expect(alternative.model).toMatchObject({ pattern: '.*\\S.*' });
    expect(alternative.brands.items).toMatchObject({ pattern: '.*\\S.*' });
  });

  it('lets a lone alternative browse but constrains every sibling branch', () => {
    const alternatives = SEARCH_PRODUCTS_INTENT_SCHEMA.properties.alternatives;
    expect(alternatives.anyOf).toHaveLength(2);
    expect(alternatives.anyOf[0]).toMatchObject({ maxItems: 1 });
    const constrained = alternatives.anyOf[1].items.anyOf;
    expect(constrained).toHaveLength(5);
    expect(constrained).toContainEqual({
      required: ['attributes'],
      properties: { attributes: { minItems: 1 } },
    });
  });
});
