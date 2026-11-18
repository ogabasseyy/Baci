import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useSearchNavigationGuard } from './use-search-navigation-guard';

const mockNavigation = { addListener: jest.fn(), isFocused: jest.fn() };
const mockDismiss = jest.fn<Promise<void>, []>();
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/components/ui/dismiss-keyboard-for-navigation', () => ({
  dismissKeyboardForNavigation: () => mockDismiss(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.isFocused.mockReturnValue(true);
  mockNavigation.addListener.mockReturnValue(jest.fn());
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());

it('ignores duplicate taps while dismissal is pending and releases the guard', async () => {
  let release = () => {};
  mockDismiss.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const navigate = jest.fn();
  const { result } = renderHook(() =>
    useSearchNavigationGuard({ isVisible: true })
  );
  let first: Promise<void> | undefined;
  await act(async () => {
    first = result.current(navigate);
    await result.current(navigate);
  });
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  if (!first) throw new Error('Expected first navigation request');
  const firstRequest = first;
  await act(async () => {
    release();
    await firstRequest;
  });
  mockDismiss.mockResolvedValue(undefined);
  await act(async () => {
    await result.current(navigate);
  });
  expect(navigate).toHaveBeenCalledTimes(2);
});

it.each([
  'blur',
  'background',
  'query change',
  'hidden',
  'unmount',
] as const)('cancels pending navigation after %s and releases the guard', async (reason) => {
  let release = () => {};
  let appStateChange: ((state: AppStateStatus) => void) | undefined;
  mockDismiss.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      appStateChange = listener;
      return { remove: jest.fn() };
    });
  const navigate = jest.fn();
  const { result, rerender, unmount } = renderHook(
    ({ visible, query }: { visible: boolean; query: string }) =>
      useSearchNavigationGuard({ isVisible: visible, invalidationKey: query }),
    { initialProps: { visible: true, query: 'phone' } }
  );
  const retainedCallback = result.current;
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = result.current(navigate);
  });
  if (reason === 'blur') mockNavigation.addListener.mock.calls[0]?.[1]();
  if (reason === 'background') appStateChange?.('background');
  if (reason === 'query change') rerender({ visible: true, query: 'laptop' });
  if (reason === 'hidden') rerender({ visible: false, query: 'phone' });
  if (reason === 'unmount') unmount();
  if (!pending) throw new Error('Expected pending navigation request');
  const pendingRequest = pending;
  await act(async () => {
    release();
    await pendingRequest;
  });
  expect(navigate).not.toHaveBeenCalled();
  if (reason === 'hidden') rerender({ visible: true, query: 'phone' });
  mockDismiss.mockResolvedValue(undefined);
  mockNavigation.isFocused.mockReturnValue(true);
  await act(async () => {
    await (reason === 'unmount' ? retainedCallback : result.current)(navigate);
  });
  if (reason === 'unmount') {
    expect(navigate).not.toHaveBeenCalled();
  } else {
    expect(navigate).toHaveBeenCalledTimes(1);
  }
});
