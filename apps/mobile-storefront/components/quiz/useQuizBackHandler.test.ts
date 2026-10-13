import { renderHook } from '@testing-library/react-native';
import { useQuizBackHandler } from './useQuizBackHandler';

it('releases only its own handler when a different surface has taken ownership', () => {
  const first = jest.fn();
  const second = jest.fn();
  const ref = { current: null as (() => void) | null };
  const hook = renderHook(() => useQuizBackHandler(ref, first));
  expect(ref.current).toBe(first);
  ref.current = second;
  hook.unmount();
  expect(ref.current).toBe(second);
});

it('removes the handler on unmount rather than retaining an obsolete screen', () => {
  const ref = { current: null as (() => void) | null };
  const hook = renderHook(() => useQuizBackHandler(ref, jest.fn()));
  hook.unmount();
  expect(ref.current).toBeNull();
});
