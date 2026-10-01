import { describe, expect, it } from 'vitest';
import { isBuilderAiPropValue } from './is-builder-ai-prop-value';

describe('isBuilderAiPropValue', () => {
  it('accepts valid enums and rejects invalid numeric constraints', () => {
    expect(isBuilderAiPropValue('Header', 'paddingY', 'md')).toBe(true);
    expect(isBuilderAiPropValue('ProductGrid', 'limit', 0)).toBe(false);
  });
});
