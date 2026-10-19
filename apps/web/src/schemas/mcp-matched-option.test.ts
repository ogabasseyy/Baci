import { describe, expect, it } from 'vitest';
import { mcpMatchedOptionSchema } from './mcp-matched-option';

describe('matched product option schema', () => {
  it('accepts a search result option with authoritative facts', () => {
    expect(
      mcpMatchedOptionSchema.safeParse({
        kind: 'variant',
        option_id: 'variant-1',
        condition: 'new',
        price: 100,
        attributes: { storage: '256GB' },
      }).success
    ).toBe(true);
  });

  it('rejects an option without a confirmed price', () => {
    expect(
      mcpMatchedOptionSchema.safeParse({
        kind: 'variant',
        option_id: 'variant-1',
        condition: 'new',
        attributes: {},
      }).success
    ).toBe(false);
  });
});
