// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMerchantScopedPending } from './useMerchantScopedPending';

describe('useMerchantScopedPending', () => {
  it('tracks overlapping requests independently for each merchant', () => {
    const { result } = renderHook(() => useMerchantScopedPending());

    act(() => {
      result.current.begin('merchant-a');
      result.current.begin('merchant-a');
      result.current.begin('merchant-b');
    });

    expect(result.current.isPending('merchant-a')).toBe(true);
    expect(result.current.isPending('merchant-b')).toBe(true);

    act(() => result.current.end('merchant-a'));
    expect(result.current.isPending('merchant-a')).toBe(true);

    act(() => result.current.end('merchant-a'));
    expect(result.current.isPending('merchant-a')).toBe(false);
    expect(result.current.isPending('merchant-b')).toBe(true);
  });

  it('ignores missing merchant targets and unmatched completions', () => {
    const { result } = renderHook(() => useMerchantScopedPending());

    act(() => {
      result.current.begin(null);
      result.current.end(null);
      result.current.end('merchant-a');
    });

    expect(result.current.isPending(null)).toBe(false);
    expect(result.current.isPending('merchant-a')).toBe(false);
  });
});
