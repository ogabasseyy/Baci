import { describe, expect, it } from 'vitest';
import { isSelfComparePair } from './is-self-compare-pair';

describe('isSelfComparePair', () => {
  it('identifies equal decoded compare keys as an impossible self-comparison', () => {
    expect(
      isSelfComparePair({
        leftKey: 'iphone-17-pro-max',
        rightKey: 'iphone-17-pro-max',
      })
    ).toBe(true);
  });

  it('preserves distinct products, brands, and aliases for normal comparison resolution', () => {
    expect(
      isSelfComparePair({
        leftKey: 'samsung-galaxy-z-trifold',
        rightKey: 'iphone-17-pro-max',
      })
    ).toBe(false);
    expect(isSelfComparePair({ leftKey: 'apple', rightKey: 'samsung' })).toBe(
      false
    );
    expect(
      isSelfComparePair({
        leftKey: 'iphone-17-pro-max',
        rightKey: 'iphone-17-pro-max-uuid-alias',
      })
    ).toBe(false);
  });
});
