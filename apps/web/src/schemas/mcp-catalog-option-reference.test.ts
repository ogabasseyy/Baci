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

  it('accepts the exact matched_option handoff shape while keeping facts optional', () => {
    expect(
      mcpCatalogOptionReferenceSchema.safeParse({
        kind: 'variant',
        option_id: 'variant-1',
        condition: 'new',
        price: 1,
        attributes: { storage: '256GB' },
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
