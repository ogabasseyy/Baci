import { describe, expect, it } from 'vitest';
import { featuresPatchSchema } from './features-patch';

describe('featuresPatchSchema', () => {
  it('rejects duplicate Feature titles', () => {
    expect(
      featuresPatchSchema.safeParse({
        componentType: 'Features',
        features: [
          { description: 'Fast', title: 'Delivery' },
          { description: 'Free', title: 'Delivery' },
        ],
      }).success
    ).toBe(false);
  });
});
