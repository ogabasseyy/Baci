import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ad-tracking-cookies', () => ({
  AD_ATTRIBUTION_UPDATED_EVENT: 'baci:ad-attribution-updated',
  getAdTrackingData: vi.fn(() => ({ fbclid: 'test-fbclid' })),
  generateEventId: vi.fn(() => 'evt-12345'),
  shouldApplyLimitedDataUse: vi.fn(() => false),
}));

import {
  generateEventId,
  getAdTrackingData,
  shouldApplyLimitedDataUse,
} from '@/lib/ad-tracking-cookies';
import { useAdTracking } from './use-ad-tracking';

describe('useAdTracking', () => {
  it.each([
    ['trackFacebookPurchase', ['phone']],
    ['trackPurchase', ['phone']],
    ['trackFacebookPurchase', []],
    ['trackPurchase', []],
  ] as const)('matches purchase product IDs to catalog groups with %s and %j', (method, ids) => {
    const fbq = vi.fn();
    const original = Object.getOwnPropertyDescriptor(window, 'fbq');
    try {
      window.fbq = fbq;
      const { result } = renderHook(() => useAdTracking());
      act(() => {
        result.current[method](891000, 'NGN', [...ids]);
      });
      expect(fbq).toHaveBeenCalledWith(
        'track',
        'Purchase',
        expect.objectContaining({
          content_ids: [...ids],
          content_type: 'product_group',
        }),
        expect.any(Object)
      );
    } finally {
      if (original) Object.defineProperty(window, 'fbq', original);
      else delete window.fbq;
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish the default cookie snapshot each test — mockReturnValue set
    // by the async-event test would otherwise leak into later tests.
    vi.mocked(getAdTrackingData).mockReturnValue({ fbclid: 'test-fbclid' });
  });

  it('loads tracking data on mount', () => {
    const { result } = renderHook(() => useAdTracking());
    expect(getAdTrackingData).toHaveBeenCalled();
    expect(result.current.trackingData).toEqual({ fbclid: 'test-fbclid' });
  });

  it('re-reads tracking data when /api/attr fires the attribution-updated event', () => {
    // Direct ad→checkout landing: cookie not yet set at mount.
    vi.mocked(getAdTrackingData).mockReturnValue({});
    const { result } = renderHook(() => useAdTracking());
    expect(result.current.trackingData).toEqual({});

    // The capture script's /api/attr succeeds and sets the cookie, then
    // dispatches the event; the hook must pick up the now-present click ID.
    vi.mocked(getAdTrackingData).mockReturnValue({ gclid: 'late-gclid' });
    act(() => {
      window.dispatchEvent(new Event('baci:ad-attribution-updated'));
    });

    expect(result.current.trackingData).toEqual({ gclid: 'late-gclid' });
  });

  it('detects non-California user by default', () => {
    const { result } = renderHook(() => useAdTracking());
    expect(result.current.isCaliforniaUser).toBe(false);
  });

  it('detects California user when timezone matches', () => {
    vi.mocked(shouldApplyLimitedDataUse).mockReturnValue(true);
    const { result } = renderHook(() => useAdTracking());
    expect(result.current.isCaliforniaUser).toBe(true);
  });

  it('generates a purchase event ID', () => {
    const { result } = renderHook(() => useAdTracking());
    let eventId = '';
    act(() => {
      eventId = result.current.generatePurchaseEventId();
    });
    expect(generateEventId).toHaveBeenCalled();
    expect(eventId).toBe('evt-12345');
    expect(result.current.purchaseEventId).toBe('evt-12345');
  });

  it('returns tracking data for order creation', () => {
    const { result } = renderHook(() => useAdTracking());
    const orderData = result.current.getTrackingForOrder('custom-evt');
    expect(orderData).toMatchObject({
      fbclid: 'test-fbclid',
      eventId: 'custom-evt',
    });
  });

  it('fires Facebook pixel via trackFacebookPurchase', () => {
    const mockFbq = vi.fn();
    Object.defineProperty(window, 'fbq', { value: mockFbq, writable: true });

    const { result } = renderHook(() => useAdTracking());
    let eventId = '';
    act(() => {
      eventId = result.current.trackFacebookPurchase(5000, 'NGN', ['prod-1']);
    });
    expect(eventId).toBe('evt-12345');
    expect(mockFbq).toHaveBeenCalledWith(
      'track',
      'Purchase',
      expect.objectContaining({ value: 5000, currency: 'NGN' }),
      { eventID: 'evt-12345' }
    );
  });

  it('trackPurchase returns tracking data with eventId', () => {
    const { result } = renderHook(() => useAdTracking());
    let trackingResult:
      | ReturnType<typeof result.current.trackPurchase>
      | undefined;
    act(() => {
      trackingResult = result.current.trackPurchase(1000, 'NGN');
    });
    expect(trackingResult?.eventId).toBe('evt-12345');
  });
});
