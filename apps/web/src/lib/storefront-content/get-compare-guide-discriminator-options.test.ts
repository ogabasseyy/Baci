import { describe, expect, it } from 'vitest';
import { getCompareGuideDiscriminatorOptions } from './get-compare-guide-discriminator-options';

describe('getCompareGuideDiscriminatorOptions', () => {
  it('allows base-model fallback for distinct compared products', () => {
    expect(
      getCompareGuideDiscriminatorOptions([
        { identifier: 'iphone 15' },
        { identifier: 'galaxy s24' },
      ])
    ).toEqual({
      allowPartialDiscriminatorGroups: true,
      allowMissingDiscriminatorGroups: true,
    });
  });

  it('keeps strict matching for same-model variants', () => {
    expect(
      getCompareGuideDiscriminatorOptions([
        { identifier: 'iphone 15' },
        { identifier: 'iphone 15' },
      ])
    ).toEqual({});
  });
});
