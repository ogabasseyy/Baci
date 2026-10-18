import { describe, expect, it } from 'vitest';
import { mcpCatalogOptionReferenceSchema } from './mcp-catalog-option-reference';

describe('catalog option reference schema', () => {
  it('accepts a bounded option identity without caller-supplied facts', () => {
    expect(
      mcpCatalogOptionReferenceSchema.safeParse({
        kind: 'offer',
        option_id: 'offer-1',
        condition: 'used',
      }).success
    ).toBe(true);
  });

  it('rejects price fields and empty identifiers', () => {
    expect(
      mcpCatalogOptionReferenceSchema.safeParse({
        kind: 'offer',
        option_id: '',
        condition: 'used',
        price: 1,
      }).success
    ).toBe(false);
  });
});
