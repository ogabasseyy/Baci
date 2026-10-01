import { describe, expect, it } from 'vitest';
import { hasConsoleProductDescriptor } from './has-console-product-descriptor';

describe('hasConsoleProductDescriptor', () => {
  it('detects an explicit console product class', () => {
    expect(
      hasConsoleProductDescriptor(['PlayStation 5 Console'], (value) =>
        value.toLowerCase().split(/\s+/u)
      )
    ).toBe(true);
  });

  it('does not infer the class from unrelated sources', () => {
    expect(
      hasConsoleProductDescriptor(['PlayStation 5 Pro'], (value) =>
        value.toLowerCase().split(/\s+/u)
      )
    ).toBe(false);
  });
});
