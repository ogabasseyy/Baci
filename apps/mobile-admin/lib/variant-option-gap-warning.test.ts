import { describe, expect, it } from 'vitest';
import { describeVariantOptionGaps } from './variant-option-gap-warning';

const variant = (attributes: Record<string, string>) => ({
  attributes: Object.entries(attributes).map(([key, value]) => ({
    key,
    value,
  })),
});

describe('describeVariantOptionGaps', () => {
  it('returns null when every variant fills the same options', () => {
    expect(
      describeVariantOptionGaps([
        variant({ storage: '1TB', region: 'Europe' }),
        variant({ storage: '825GB', region: 'Japan' }),
      ])
    ).toBeNull();
  });

  it('returns null when there are no variants', () => {
    expect(describeVariantOptionGaps([])).toBeNull();
  });

  it('names the variant row and the missing options with readable labels', () => {
    const message = describeVariantOptionGaps([
      variant({ storage: '1TB', sim_type: 'eSIM Only', region: 'Europe' }),
      variant({ storage: '825GB', sim_type: '', region: '  ' }),
    ]);

    expect(message).toContain('Variant 2: Sim Type, Region');
    expect(message).not.toContain('Variant 1:');
    expect(message).toContain('Fill them in');
  });

  it('lists three variants and counts the rest', () => {
    const message = describeVariantOptionGaps([
      variant({ ram: '8GB', color: 'Black' }),
      variant({ color: 'Blue' }),
      variant({ color: 'Red' }),
      variant({ color: 'Green' }),
      variant({ color: 'White' }),
      variant({ color: 'Gold' }),
    ]);

    expect(message).toContain('Variant 2: Ram');
    expect(message).toContain('Variant 4: Ram');
    expect(message).not.toContain('Variant 5:');
    expect(message).toContain('…and 2 more');
  });

  it('does not add a remaining count for exactly three incomplete variants', () => {
    const message = describeVariantOptionGaps([
      variant({ ram: '8GB', color: 'Black' }),
      variant({ color: 'Blue' }),
      variant({ color: 'Red' }),
      variant({ color: 'Green' }),
    ]);

    expect(message).toContain('Variant 4: Ram');
    expect(message).not.toContain('more');
  });
});
