import { act, renderHook } from '@testing-library/react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { useWalletPinSettings } from './use-wallet-pin-settings';

const mockRefresh = jest.fn();
let mockStatus: object = {
  primary: true,
  hasPin: false,
  resetRequired: false,
  available: true,
};
jest.mock('./use-wallet-pin-settings-gate', () => ({
  useWalletPinSettingsGate: () => ({
    state: 'ready',
    status: mockStatus,
    refresh: mockRefresh,
  }),
}));
jest.mock('@/lib/wallet-pin-api', () => ({ submitWalletPin: jest.fn() }));
jest.mock('@/lib/wallet-pin-change-api', () => ({
  changeWalletPin: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() },
  useNavigation: () => ({ addListener: () => () => undefined }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, signOut: jest.fn() }),
}));

describe('useWalletPinSettings', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockStatus = {
      primary: true,
      hasPin: false,
      resetRequired: false,
      available: true,
    };
  });

  it('derives the mode from the server status', () => {
    const { result, rerender } = renderHook(() => useWalletPinSettings());
    expect(result.current.mode).toBe('set');
    mockStatus = {
      primary: true,
      hasPin: true,
      resetRequired: false,
      available: true,
    };
    rerender({});
    expect(result.current.mode).toBe('change');
    mockStatus = {
      primary: true,
      hasPin: true,
      resetRequired: true,
      available: true,
    };
    rerender({});
    expect(result.current.mode).toBe('reset');
  });

  it('clears fields and the validation error path sends nothing', () => {
    const { result } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('12');
      result.current.setConfirmPin('12');
    });
    act(() => result.current.submit());
    expect(result.current.error).toBe('Enter 4 to 6 digits.');
    expect(submitWalletPin).not.toHaveBeenCalled();
    expect(changeWalletPin).not.toHaveBeenCalled();
  });

  it('submits a valid first PIN once and clears the fields', async () => {
    (submitWalletPin as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    await act(async () => result.current.submit());
    expect(submitWalletPin).toHaveBeenCalledWith('set', '1234', 'user-1');
    expect(result.current.newPin).toBe('');
    expect(result.current.busy).toBe(false);
  });
});
