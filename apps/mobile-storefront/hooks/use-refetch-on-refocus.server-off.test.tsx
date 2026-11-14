import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useFocusEffect } from 'expo-router';
import { useRefetchOnRefocus } from './use-refetch-on-refocus';

// Drive focus by hand: each call of the captured effect is one focus.
let focus: () => void = () => undefined;
beforeEach(() => {
  jest.mocked(useFocusEffect).mockImplementation((effect) => {
    focus = effect as () => void;
  });
});

// A plain wallet re-read: the same with PiggyVest off.
describe('bugfix: wallet showed a stale balance after re-entry (walk 10)', () => {
  it('re-reads once each time the screen regains focus, not on first focus', () => {
    // Arrange
    const refetch = jest.fn();
    renderHook(() => useRefetchOnRefocus(refetch));

    // Act: first focus is the mount; then the customer leaves and returns.
    focus();
    expect(refetch).not.toHaveBeenCalled();
    focus();
    focus();

    // Assert: exactly once per regained focus.
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});

describe('bugfix: a new refetch callback re-ran the focus effect', () => {
  it('does not refetch when only the callback changes while focused', () => {
    // Model useFocusEffect: it runs the effect again whenever its identity changes.
    let lastEffect: unknown;
    jest.mocked(useFocusEffect).mockImplementation((effect) => {
      if (effect !== lastEffect) {
        lastEffect = effect;
        (effect as () => void)();
      }
    });
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ refetch }: { refetch: () => unknown }) => useRefetchOnRefocus(refetch),
      { initialProps: { refetch: first } }
    );

    rerender({ refetch: second });
    rerender({ refetch: first });

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('calls the latest refetch on a real refocus', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ refetch }: { refetch: () => unknown }) => useRefetchOnRefocus(refetch),
      { initialProps: { refetch: first } }
    );
    rerender({ refetch: second });

    focus();
    focus();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
