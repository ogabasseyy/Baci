import { renderHook } from '@testing-library/react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { useWalletPinSettings } from './use-wallet-pin-settings';

jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => ({
    state: 'off',
    status: null,
    refresh: jest.fn(),
  }),
}));
jest.mock('@/lib/wallet-pin-api', () => ({ submitWalletPin: jest.fn() }));
jest.mock('@/lib/wallet-pin-change-api', () => ({
  changeWalletPin: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => undefined }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, signOut: jest.fn() }),
}));

describe('useWalletPinSettings when the server keeps PiggyVest off', () => {
  it('reports off and makes no PIN request on its own', () => {
    const { result } = renderHook(() => useWalletPinSettings());
    expect(result.current.gateState).toBe('off');
    expect(submitWalletPin).not.toHaveBeenCalled();
    expect(changeWalletPin).not.toHaveBeenCalled();
  });
});
