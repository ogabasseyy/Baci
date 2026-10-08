'use client';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { SearchComparisonSession } from './search-comparison-session';
import { useSearchComparisonIntent } from './use-search-comparison-intent';

describe('useSearchComparisonIntent', () => {
  it('stays idle outside a session', () => {
    const { result } = renderHook(() => useSearchComparisonIntent());
    expect(result.current.active).toBe(false);
    act(() => {
      result.current.activate();
    });
    expect(result.current.active).toBe(false);
  });

  it('activates within a session', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SearchComparisonSession, { scope: 'iphone', children });
    const { result } = renderHook(() => useSearchComparisonIntent(), {
      wrapper,
    });
    expect(result.current.active).toBe(false);
    act(() => {
      result.current.activate();
    });
    expect(result.current.active).toBe(true);
  });
});
