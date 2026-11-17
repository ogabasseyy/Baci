import { renderHook } from '@testing-library/react-native';
import { useHeldWhileAdding } from './use-held-while-adding';

// Pure sizing: no server call, so it is the same with PiggyVest on or off.
describe('useHeldWhileAdding', () => {
  it('keeps the height while an add is in flight, then follows the content again', () => {
    const { result, rerender } = renderHook(
      ({ adding, measured }: { adding: boolean; measured?: number }) =>
        useHeldWhileAdding(adding, measured),
      { initialProps: { adding: false, measured: 500 } }
    );
    expect(result.current).toBe(500);
    rerender({ adding: true, measured: 500 });
    rerender({ adding: true, measured: 440 });
    expect(result.current).toBe(500);
    rerender({ adding: true, measured: 520 });
    expect(result.current).toBe(520);
    rerender({ adding: false, measured: 440 });
    expect(result.current).toBe(440);
  });

  it('passes an unmeasured sheet through', () => {
    const { result } = renderHook(() => useHeldWhileAdding(true, undefined));
    expect(result.current).toBeUndefined();
  });
});
