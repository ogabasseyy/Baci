import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { VtuWalletPayHost } from './VtuWalletPayHost';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: undefined,
    isRefetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'https://api.test' }));
jest.mock('@react-native-vector-icons/ionicons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/ui/ModalSheet', () => ({
  ModalSheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children: unknown;
  }) => (visible ? children : null),
}));
jest.mock('@/stores/auth-store', () => {
  const state = { user: null, session: null };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

describe('VtuWalletPayHost with the server keeping PiggyVest off', () => {
  it('shows no sheet and covers nothing', () => {
    render(<VtuWalletPayHost colors={Colors.light} />);
    expect(screen.queryByText('Pay from PiggyVest')).toBeNull();
    expect(useVtuWalletPayStore.getState().covers(500)).toBe(false);
  });
});
