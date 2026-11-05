import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getChatDeliveryContext } from './get-chat-delivery-context';
import { usePrivateDeliveryMode } from './use-private-delivery-mode';

describe('usePrivateDeliveryMode', () => {
  it('routes submit to the private handler without forwarding transcript text', () => {
    const { result } = renderHook(() => usePrivateDeliveryMode(true, vi.fn()));
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
    const { result } = renderHook(() => usePrivateDeliveryMode(true, vi.fn()));
    const normalSubmit = vi.fn();
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    act(() => result.current.handleComposerSubmit(event, normalSubmit));
    expect(normalSubmit).toHaveBeenCalledWith(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('closes private mode, unlocks the composer, and clears input when eligibility is lost', () => {
    const setInput = vi.fn();
    const initial = {
      lines: [{ cartItemId: 'line-1', quantity: 1, price: 100 }],
      subtotal: 100,
      hydrated: true,
      routingMode: 'domain',
      merchantSlug: 'shop',
      cartMerchantSlug: 'shop',
      country: 'NG',
      payoutCurrency: 'NGN',
    };
    const { result, rerender } = renderHook(
      ({ cartMerchantSlug }: { cartMerchantSlug: string }) => usePrivateDeliveryMode(
        getChatDeliveryContext({ ...initial, cartMerchantSlug }).eligible,
        setInput,
      ),
      { initialProps: { cartMerchantSlug: 'shop' } },
    );
    act(() => {
      result.current.start();
      result.current.setComposerLocked(true);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.composerLocked).toBe(true);

    rerender({ cartMerchantSlug: 'another-shop' });

    expect(result.current.active).toBe(false);
    expect(result.current.composerLocked).toBe(false);
    expect(setInput).toHaveBeenCalledWith('');
  });
});
