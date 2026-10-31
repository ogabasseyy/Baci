import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOrderGiglQuoteState } from './useOrderGiglQuoteState';
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

describe('useOrderGiglQuoteState', () => {
  it('applies a bound quote and remembers the address it was priced from', () => {
    const { result } = renderHook(() => useOrderGiglQuoteState());

    act(() => result.current.applyQuote(quoteResult, 'address-a'));

    expect(result.current.quote?.price).toBe(11000);
    expect(result.current.quoteRef.current?.price).toBe(11000);
    expect(result.current.quoteBoundRef.current).toBe(true);
    expect(result.current.wallet).toEqual({
      availableBalance: 1000,
      canBook: false,
      shortfall: 10000,
    });
    expect(result.current.isBoundTo('address-a')).toBe(true);
    expect(result.current.isBoundTo('address-b')).toBe(false);
  });

  it('treats a preview quote as unbound for every address', () => {
    const { result } = renderHook(() => useOrderGiglQuoteState());

    act(() => result.current.applyQuote(quoteResult, null));

    expect(result.current.quote?.price).toBe(11000);
    expect(result.current.quoteBoundRef.current).toBe(false);
    expect(result.current.isBoundTo('address-a')).toBe(false);
  });

  it('forgets the quote, wallet and bound address when invalidated', () => {
    const { result } = renderHook(() => useOrderGiglQuoteState());
    act(() => result.current.applyQuote(quoteResult, 'address-a'));

    act(() => result.current.invalidateQuote());

    expect(result.current.quote).toBeNull();
    expect(result.current.quoteRef.current).toBeNull();
    expect(result.current.wallet).toBeNull();
    expect(result.current.walletRef.current).toBeNull();
    expect(result.current.isBoundTo('address-a')).toBe(false);
  });

  it('mirrors wallet updates into the ref before the next render', () => {
    const { result } = renderHook(() => useOrderGiglQuoteState());
    const next = { availableBalance: 20000, canBook: true, shortfall: 0 };

    act(() => {
      result.current.setWallet(next);
      expect(result.current.walletRef.current).toBe(next);
    });

    expect(result.current.wallet).toBe(next);
  });
});
