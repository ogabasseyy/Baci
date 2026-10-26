import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { WalletDiscoveryBubble } from './WalletDiscoveryBubble';

const mockDismiss = jest.fn(() => {
  mockVisible = false;
});
const mockVisibilityChange = jest.fn();
let mockPath = '/';
let mockVisible = true;
let mockUserId: string | undefined = 'user';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  usePathname: () => mockPath,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      customer: null,
      merchantId: 'merchant',
      isInitialized: true,
    }),
}));
jest.mock('@/hooks/use-wallet-discovery-hint', () => ({
  useWalletDiscoveryHint: () => ({
    visible: mockVisible,
    dismiss: mockDismiss,
  }),
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

const props = {
  walletCenter: 230,
  availableWidth: 350,
  homeFocused: true,
  onVisibilityChange: mockVisibilityChange,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockPath = '/';
  mockVisible = true;
  mockUserId = 'user';
});

it('opens Wallet when the savings bubble is tapped', () => {
  render(<WalletDiscoveryBubble {...props} />);
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(true);
  fireEvent.press(
    screen.getByRole('button', { name: 'Save towards your next device' })
  );
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/wallet');
});

it('dismisses without navigating and provides a 44-point close target', () => {
  const { rerender } = render(<WalletDiscoveryBubble {...props} />);
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(true);
  const close = screen.getByRole('button', { name: 'Dismiss savings tip' });
  expect(close).toHaveStyle({ width: 44, height: 44 });
  fireEvent.press(close);
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  rerender(<WalletDiscoveryBubble {...props} />);
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(false);
  expect(router.push).not.toHaveBeenCalled();
});

it('never covers checkout even when Home is still mounted underneath', () => {
  mockPath = '/checkout';
  render(<WalletDiscoveryBubble {...props} />);
  expect(
    screen.queryByRole('button', { name: 'Save towards your next device' })
  ).toBeNull();
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(false);
});

it('does not show on the Wallet tab or for signed-out customers', () => {
  const { rerender } = render(
    <WalletDiscoveryBubble {...props} homeFocused={false} />
  );
  expect(
    screen.queryByRole('button', { name: 'Save towards your next device' })
  ).toBeNull();
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(false);
  mockUserId = undefined;
  rerender(<WalletDiscoveryBubble {...props} />);
  expect(
    screen.queryByRole('button', { name: 'Save towards your next device' })
  ).toBeNull();
  expect(mockVisibilityChange).toHaveBeenLastCalledWith(false);
});

it('stays hidden when the eligibility hook reports a dismissed tip', () => {
  mockVisible = false;
  render(<WalletDiscoveryBubble {...props} />);
  expect(
    screen.queryByRole('button', { name: 'Save towards your next device' })
  ).toBeNull();
});
