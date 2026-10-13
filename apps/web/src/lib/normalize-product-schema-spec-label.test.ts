import { describe, expect, it } from 'vitest';

import { normalizeProductSchemaSpecLabel } from './normalize-product-schema-spec-label';

describe('normalizeProductSchemaSpecLabel', () => {
  it('normalizes whitespace and punctuation in legacy specification labels', () => {
    expect(normalizeProductSchemaSpecLabel('  Card-Slot  ')).toBe('card slot');
    expect(normalizeProductSchemaSpecLabel('5G Support:')).toBe('5g support');
  });
});
