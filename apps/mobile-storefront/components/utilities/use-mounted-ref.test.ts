import { renderHook } from '@testing-library/react-native';
import { createElement, StrictMode } from 'react';
import { useMountedRef } from './use-mounted-ref';

describe('useMountedRef', () => {
  it('reports mounted while mounted', () => {
    const { result } = renderHook(() => useMountedRef());

    expect(result.current.current).toBe(true);
  });

  it('flips to unmounted on cleanup', () => {
    const { result, unmount } = renderHook(() => useMountedRef());
    expect(result.current.current).toBe(true);

    unmount();

    expect(result.current.current).toBe(false);
  });

  it('stays mounted through Strict Mode effect replay', () => {
    // Strict Mode runs setup → cleanup → setup: without a setup
    // re-arm the first cleanup would leave the ref false while the
    // form is still mounted, suppressing every checkout.
    const { result } = renderHook(() => useMountedRef(), {
      wrapper: ({ children }) => createElement(StrictMode, null, children),
    });

    expect(result.current.current).toBe(true);
  });
});
