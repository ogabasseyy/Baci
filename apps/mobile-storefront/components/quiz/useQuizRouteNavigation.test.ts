import { act, renderHook } from '@testing-library/react-native';
import { useQuizStore } from '@/stores/quiz-store';
import { useQuizRouteNavigation } from './useQuizRouteNavigation';

let preventRemoval = false;
let nativeBack: () => void = () => undefined;
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    preventRemoval = prevent;
    nativeBack = callback;
  },
}));
afterEach(() => {
  useQuizStore.getState().resetForAccountChange();
  jest.clearAllMocks();
});
it.each([
  'question',
  'submitting',
  'starting',
  'result',
] as const)('uses the same surface policy for header and native back during %s', (status) => {
  useQuizStore.setState({ status });
  const { result } = renderHook(() => useQuizRouteNavigation());
  const handler = jest.fn();
  result.current.backHandlerRef.current = handler;
  act(() => result.current.onBack());
  act(() => nativeBack());
  expect(preventRemoval).toBe(true);
  expect(handler).toHaveBeenCalledTimes(2);
  expect(mockBack).not.toHaveBeenCalled();
});
it('allows normal removal only from the lobby', () => {
  useQuizStore.setState({ status: 'ready' });
  const { result } = renderHook(() => useQuizRouteNavigation());
  result.current.onBack();
  expect(preventRemoval).toBe(false);
  expect(mockBack).toHaveBeenCalledTimes(1);
});
