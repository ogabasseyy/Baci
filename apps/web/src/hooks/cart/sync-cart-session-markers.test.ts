import { afterEach, describe, expect, it } from 'vitest';
import {
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
} from './cart-device-session-markers';
import {
  readCartSessionHint,
  resetCartSessionHintForTests,
} from './cart-session-hint';
import { syncCartSessionMarkers } from './sync-cart-session-markers';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_SLUG = 'store-a';

describe('syncCartSessionMarkers', () => {
  afterEach(() => {
    window.localStorage.clear();
    resetCartSessionHintForTests();
    clearCartDeviceSessionActive(MERCHANT_SLUG);
  });

  it('syncs both hint cookie and device marker for active vs inactive states', () => {
    syncCartSessionMarkers({
      merchantId: MERCHANT_ID,
      merchantSlug: MERCHANT_SLUG,
      active: true,
    });
    expect(readCartSessionHint(MERCHANT_ID)).toBe('1');
    expect(hasActiveCartDeviceSession(MERCHANT_SLUG)).toBe(true);

    syncCartSessionMarkers({
      merchantId: MERCHANT_ID,
      merchantSlug: MERCHANT_SLUG,
      active: false,
      preserveDeviceMarker: true,
    });
    expect(readCartSessionHint(MERCHANT_ID)).toBe('0');
    expect(hasActiveCartDeviceSession(MERCHANT_SLUG)).toBe(true);

    syncCartSessionMarkers({
      merchantId: MERCHANT_ID,
      merchantSlug: MERCHANT_SLUG,
      active: false,
    });
    expect(readCartSessionHint(MERCHANT_ID)).toBe('0');
    expect(hasActiveCartDeviceSession(MERCHANT_SLUG)).toBe(false);
  });
});
