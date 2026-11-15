import { describe, expect, it } from 'vitest';
import { AD_CONFIG } from '../config/ads';
import { resolveAdSlotId } from './resolve-ad-slot-id';

const placement = AD_CONFIG.PRODUCT_GRID_MPU;

describe('resolveAdSlotId', () => {
  it('uses the placement id when there is no instance', () => {
    expect(resolveAdSlotId(placement)).toBe('div-gpt-ad-grid-mpu');
  });

  it('gives each repeat of a placement its own id', () => {
    expect(resolveAdSlotId(placement, 4)).toBe('div-gpt-ad-grid-mpu-4');
    expect(resolveAdSlotId(placement, 'cart')).toBe(
      'div-gpt-ad-grid-mpu-cart'
    );
  });

  it('keeps the id a plain element id whatever the instance contains', () => {
    expect(resolveAdSlotId(placement, 'row 4 #top')).toBe(
      'div-gpt-ad-grid-mpu-row_4__top'
    );
    expect(resolveAdSlotId(placement, '')).toBe('div-gpt-ad-grid-mpu');
  });

  it('bugfix: keeps different instances different after cleaning', () => {
    expect(resolveAdSlotId(placement, 'a/b')).not.toBe(
      resolveAdSlotId(placement, 'ab')
    );
    // An all-symbol instance must not collapse onto the bare placement id.
    expect(resolveAdSlotId(placement, ' / ')).not.toBe(
      resolveAdSlotId(placement)
    );
  });

  it('returns undefined for an unknown placement', () => {
    expect(resolveAdSlotId(undefined, 4)).toBeUndefined();
  });
});
