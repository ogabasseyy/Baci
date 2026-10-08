import { act, renderHook } from '@testing-library/react-native';
import { useWalletSavedCards } from './use-wallet-saved-cards';

const mockRefetch = jest.fn();
const mockUnsubscribe = jest.fn();
const mockAddListener = jest.fn(() => mockUnsubscribe);
const mockNavigation = { addListener: mockAddListener };
const mockQuery = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockQuery(options),
}));
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));
jest.mock('@/lib/vtu-checkout', () => ({ listSavedVtuCards: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockReturnValue({ data: [], isError: false, refetch: mockRefetch });
});

it.each([
  undefined,
  [],
])('hides the action while loading or when there are no cards', (data) => {
  mockQuery.mockReturnValue({ data, isError: false, refetch: mockRefetch });
  expect(
    renderHook(() => useWalletSavedCards('customer', 'merchant')).result.current
  ).toBe(false);
});
it('shows the action only with saved cards and refreshes on return', () => {
  mockQuery.mockReturnValue({
    data: [{ id: 'card' }],
    isError: false,
    refetch: mockRefetch,
  });
  const { result, unmount } = renderHook(() =>
    useWalletSavedCards('customer', 'merchant')
  );
  expect(result.current).toBe(true);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.objectContaining({
      queryKey: ['wallet-saved-cards', 'merchant', 'customer'],
      enabled: true,
    })
  );
  act(() => {
    const listener = (
      mockAddListener.mock.calls[0] as unknown as [string, () => void]
    )[1];
    listener();
  });
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  unmount();
  expect(mockUnsubscribe).toHaveBeenCalled();
});
it('hides stale cards after an error or without an authenticated customer', () => {
  mockQuery.mockReturnValue({
    data: [{ id: 'card' }],
    isError: true,
    refetch: mockRefetch,
  });
  expect(
    renderHook(() => useWalletSavedCards('customer', 'merchant')).result.current
  ).toBe(false);
  mockQuery.mockReturnValue({
    data: [{ id: 'card' }],
    isError: false,
    refetch: mockRefetch,
  });
  expect(
    renderHook(() => useWalletSavedCards(undefined, 'merchant')).result.current
  ).toBe(false);
  expect(mockQuery).toHaveBeenLastCalledWith(
    expect.objectContaining({ enabled: false })
  );
});
