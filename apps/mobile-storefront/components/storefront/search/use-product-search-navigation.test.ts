import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import type { Product } from '@/types/product';
import { useProductSearchNavigation } from './use-product-search-navigation';

const mockDismiss = jest.fn();
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
  const onNavigate = jest.fn();
  const saveSearch = jest.fn();
  const hook = renderHook(
    ({ isVisible, query }: { isVisible: boolean; query?: string }) =>
      useProductSearchNavigation({
        isVisible,
        query: query ?? ' phone ',
        saveSearch,
        onClose,
        onNavigate,
      }),
    { initialProps: { isVisible: true } }
  );
  return { ...hook, release, onClose, onNavigate, saveSearch };
}
beforeEach(() => {
  jest.clearAllMocks();
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
  expect(h.saveSearch).toHaveBeenCalledTimes(1);
  await act(async () => {
    h.release();
    await navigation;
  });
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
});
it('cancels pending navigation when unmounted', async () => {
  const h = setup();
  const navigation = h.result.current(product);
  h.unmount();
  h.release();
  await navigation;
  expect(h.onNavigate).not.toHaveBeenCalled();
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
});
