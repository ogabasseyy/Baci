import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { Product } from '@/types/product';
import { useProductSearchNavigation } from './use-product-search-navigation';

const mockDismiss = jest.fn();
const mockNavigation = { addListener: jest.fn(), isFocused: jest.fn() };
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/components/ui/dismiss-keyboard-for-navigation', () => ({
  dismissKeyboardForNavigation: () => mockDismiss(),
}));
const product = { name: 'Phone', slug: 'phone' } as Product;
function setup() {
  let release = () => {};
  mockDismiss.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const onClose = jest.fn();
  const onSelectionStart = jest.fn();
  const onNavigate = jest.fn();
  const saveSearch = jest.fn();
  const hook = renderHook(
    ({ isVisible, query }: { isVisible: boolean; query?: string }) =>
      useProductSearchNavigation({
        isVisible,
        query: query ?? ' phone ',
        saveSearch,
        onClose,
        onSelectionStart,
        onNavigate,
      }),
    { initialProps: { isVisible: true } }
  );
  return {
    ...hook,
    release,
    onClose,
    onNavigate,
    saveSearch,
    onSelectionStart,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockNavigation.isFocused.mockReturnValue(true);
  mockNavigation.addListener.mockReturnValue(jest.fn());
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
});
afterEach(() => jest.restoreAllMocks());
it('keeps results visible and ignores duplicate taps until keyboard layout settles', async () => {
  const h = setup();
  let navigation: Promise<void> | undefined;
  act(() => {
    navigation = h.result.current(product);
    void h.result.current(product);
  });
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
  expect(h.onSelectionStart).toHaveBeenCalledTimes(1);
  expect(h.onSelectionStart.mock.invocationCallOrder[0]).toBeLessThan(
    mockDismiss.mock.invocationCallOrder[0]
  );
  await act(async () => {
    h.release();
    await navigation;
  });
  expect(h.saveSearch).toHaveBeenCalledWith('phone');
  expect(h.onNavigate).toHaveBeenCalledWith(product);
  expect(h.onClose.mock.invocationCallOrder[0]).toBeLessThan(
    h.onNavigate.mock.invocationCallOrder[0]
  );
});
it('cancels pending navigation when search closes', async () => {
  const h = setup();
  const navigation = h.result.current(product);
  h.rerender({ isVisible: false });
  await act(async () => {
    h.release();
    await navigation;
  });
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
});
it('cancels pending navigation when unmounted', async () => {
  const h = setup();
  const navigation = h.result.current(product);
  h.unmount();
  h.release();
  await navigation;
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
});
it('cancels pending navigation when the app backgrounds', async () => {
  let change: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  const spy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      change = listener;
      return { remove };
    });
  const h = setup();
  const navigation = h.result.current(product);
  change?.('background');
  await act(async () => {
    h.release();
    await navigation;
  });
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalled();
  spy.mockRestore();
});

it('cancels a pending selection when the search query changes', async () => {
  const h = setup();
  const navigation = h.result.current(product);
  h.rerender({ isVisible: true, query: 'laptop' });
  await act(async () => {
    h.release();
    await navigation;
  });
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
});

it('cancels a selection when Cart covers search before the keyboard settles', async () => {
  const h = setup();
  const navigation = h.result.current(product);
  const blur = mockNavigation.addListener.mock.calls[0]?.[1];
  blur?.();
  await act(async () => {
    h.release();
    await navigation;
  });
  expect(h.onClose).not.toHaveBeenCalled();
  expect(h.onNavigate).not.toHaveBeenCalled();
  expect(h.saveSearch).not.toHaveBeenCalled();
});
