import { describe, expect, it } from 'vitest';
import { unexpectedMountProblems } from './merchant-image-pilot-readiness-coverage.mjs';

const cardMount = {
  binding: 'merchant/card-a',
  generationId: 'abc',
  merchantId: 'merchant',
  slotId: 'product-card',
  stagedOriginal: '/__pilot/originals/card.png',
};

function mountSlot(binding, slotId) {
  return { binding, slotId, status: null };
}

describe('unexpectedMountProblems', () => {
  it('fails rendered mounts outside the expected set', () => {
    expect(
      unexpectedMountProblems(
        [mountSlot('merchant/card-a', 'product-card')],
        [cardMount]
      )
    ).toEqual([]);
    expect(
      unexpectedMountProblems(
        [
          mountSlot('merchant/card-a', 'product-card'),
          mountSlot('merchant/logo-a', 'header-logo'),
        ],
        [cardMount]
      )
    ).toEqual([
      'slot "header-logo" renders mount for unexpected binding "merchant/logo-a" (stale --mounts?)',
    ]);
  });

  it('ignores reporting rows and unbound sections', () => {
    expect(
      unexpectedMountProblems(
        [
          {
            binding: 'merchant/other',
            slotId: 'product-card',
            status: 'not-optimized',
          },
          { binding: null, slotId: 'product-card', status: 'missing-binding' },
        ],
        [cardMount]
      )
    ).toEqual([]);
    expect(unexpectedMountProblems(undefined, [cardMount])).toEqual([]);
  });
});
