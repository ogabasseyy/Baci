import { describe, expect, it } from 'vitest';
import {
  isRouteVariantMissing,
  matchRouteVariantId,
} from './resolve-route-variant-match';

const variants = [{ id: 'v-1' }, { id: 'v-2' }];

describe('resolve-route-variant-match', () => {
  it('honors a link variant id that names a live variant', () => {
    expect(matchRouteVariantId('v-1', null, variants)).toBe('v-1');
  });

  it('ignores a link variant id the shopper picked past', () => {
    expect(matchRouteVariantId('v-1', 'v-1', variants)).toBeNull();
  });

  it('flags a link variant id absent from hydrated variants as missing', () => {
    expect(isRouteVariantMissing('v-gone', null, variants)).toBe(true);
  });

  it('does not flag a live or ignored variant id as missing', () => {
    expect(isRouteVariantMissing('v-1', null, variants)).toBe(false);
    expect(isRouteVariantMissing('v-gone', 'v-gone', variants)).toBe(false);
  });

  it('keeps the legacy silent path when variants never hydrate', () => {
    expect(isRouteVariantMissing('v-gone', null, undefined)).toBe(false);
    expect(matchRouteVariantId('v-1', null, undefined)).toBeNull();
  });
});
