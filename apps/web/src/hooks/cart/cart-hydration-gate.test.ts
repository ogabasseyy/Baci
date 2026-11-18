import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetCustomerSessionHintForTests,
  writeCustomerSessionHint,
} from '@/contexts/customer-session-hint';
import {
  clearCartDeviceSessionActive,
  hasActiveCartDeviceSession,
  markCartDeviceSessionActive,
} from './cart-device-session-markers';
import {
  shouldSkipEmptyGuestCartFetch,
  stampSkippedEmptyGuestCartHint,
  syncCartSessionMarkers,
} from './cart-hydration-gate';
import {
  readCartSessionHint,
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { saveSharedCartImportReceipt } from './cart-storage';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_SLUG = 'store-a';

describe('cart-hydration-gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetCartSessionHintForTests();
    resetCustomerSessionHintForTests();
    clearCartDeviceSessionActive(MERCHANT_SLUG);
  });

  afterEach(() => {
    window.localStorage.clear();
    resetCartSessionHintForTests();
    resetCustomerSessionHintForTests();
    clearCartDeviceSessionActive(MERCHANT_SLUG);
  });

  it('skips when guest is cold (null or 0 hint) with no local/session signals', () => {
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(true);

    stampSkippedEmptyGuestCartHint(MERCHANT_ID);
    expect(readCartSessionHint(MERCHANT_ID)).toBe('0');

    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(true);
  });

  it('does not skip when cartHint is 1, cache is non-empty, customer is signed in, or legacy markers exist', () => {
    writeCartSessionHint(MERCHANT_ID, '1');
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(false);

    writeCartSessionHint(MERCHANT_ID, '0');
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 1,
      })
    ).toBe(false);

    writeCustomerSessionHint(MERCHANT_SLUG, '1');
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(false);

    resetCustomerSessionHintForTests();
    markCartDeviceSessionActive(MERCHANT_SLUG);
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(false);

    clearCartDeviceSessionActive(MERCHANT_SLUG);
    saveSharedCartImportReceipt(MERCHANT_SLUG, {
      cartId: 'cart-1',
      importedAt: '2026-11-18T12:00:00.000Z',
      lineCount: 1,
    });
    expect(
      shouldSkipEmptyGuestCartFetch({
        merchantId: MERCHANT_ID,
        merchantSlug: MERCHANT_SLUG,
        cachedCount: 0,
      })
    ).toBe(false);
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
