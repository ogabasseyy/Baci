// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePathname } from './next-navigation';

describe('next-navigation fixture shim', () => {
  it('tracks window.location.pathname changes across popstate events', () => {
    window.history.pushState({}, '', '/synthetic-tenant-a/checkout');
    const { result } = renderHook(() => usePathname());

    expect(result.current).toBe('/synthetic-tenant-a/checkout');

    act(() => {
      window.history.pushState({}, '', '/synthetic-tenant-b/product');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(result.current).toBe('/synthetic-tenant-b/product');
  });
});
