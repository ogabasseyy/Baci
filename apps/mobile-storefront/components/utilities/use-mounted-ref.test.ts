import { renderHook } from '@testing-library/react-native';
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
});
