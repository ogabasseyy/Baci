import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { canOfferPrivateDeliveryEstimate, getChatPanelMobileHeightCap, usePrivateDeliveryMode } from './use-private-delivery-mode';

describe('usePrivateDeliveryMode', () => {
  it('clamps both mobile panel height bounds to the space above the anchored launcher', () => {
    expect(getChatPanelMobileHeightCap('6.75rem')).toBe(
      'max(0px, calc(100dvh - env(safe-area-inset-bottom, 0px) - 6.75rem - 5.5rem))',
    );
  });

  it('offers estimates only for hydrated NGN stores on domain routing', () => {
    const base = { hydrated: true, hasItems: true, routingMode: 'domain', country: 'NG', payoutCurrency: 'NGN' };
    expect(canOfferPrivateDeliveryEstimate(base)).toBe(true);
    expect(canOfferPrivateDeliveryEstimate({ ...base, payoutCurrency: undefined })).toBe(true);
    expect(canOfferPrivateDeliveryEstimate({ ...base, country: 'Nigeria' })).toBe(false);
    expect(canOfferPrivateDeliveryEstimate({ ...base, routingMode: 'path' })).toBe(false);
    expect(canOfferPrivateDeliveryEstimate({ ...base, payoutCurrency: 'USD' })).toBe(false);
    expect(canOfferPrivateDeliveryEstimate({ ...base, country: 'GH' })).toBe(false);
    expect(canOfferPrivateDeliveryEstimate({ ...base, hydrated: false })).toBe(false);
  });

  it('routes submit to the private handler without forwarding transcript text', () => {
    const { result } = renderHook(() => usePrivateDeliveryMode());
    const privateSubmit = vi.fn();
    const normalSubmit = vi.fn();
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    act(() => result.current.start());
    result.current.submitRef.current = privateSubmit;

    act(() => result.current.handleComposerSubmit(event, normalSubmit));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(privateSubmit).toHaveBeenCalledOnce();
    expect(normalSubmit).not.toHaveBeenCalled();
  });

  it('uses normal chat submit when private mode is inactive', () => {
    const { result } = renderHook(() => usePrivateDeliveryMode());
    const normalSubmit = vi.fn();
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    act(() => result.current.handleComposerSubmit(event, normalSubmit));
    expect(normalSubmit).toHaveBeenCalledWith(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
