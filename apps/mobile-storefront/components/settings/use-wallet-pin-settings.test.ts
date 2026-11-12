import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { submitWalletPin } from '@/lib/wallet-pin-api';
import { changeWalletPin } from '@/lib/wallet-pin-change-api';
import { useWalletPinSettings } from './use-wallet-pin-settings';

const mockRefresh = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
const mockNavigationListeners = new Map<string, () => void>();
const mockNavigation = {
  addListener: (event: string, listener: () => void) => {
    mockNavigationListeners.set(event, listener);
    return () => mockNavigationListeners.delete(event);
  },
};
let mockUserId: string | null = 'user-1';
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
  router: { back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack },
  useNavigation: () => mockNavigation,
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      signOut: jest.fn(),
    }),
}));

describe('useWalletPinSettings', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockCanGoBack.mockReturnValue(true);
    mockNavigationListeners.clear();
    mockUserId = 'user-1';
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

  it('never lets one account inherit another account\'s "confirm it\'s you"', () => {
    mockStatus = { ...mockStatus, signInConfirmationRequired: true };
    const { result, rerender } = renderHook(() => useWalletPinSettings());
    expect(result.current.needsIdentity).toBe(true);
    act(() => result.current.identityConfirmed());
    expect(result.current.needsIdentity).toBe(false);
    mockUserId = 'user-2';
    rerender({});
    expect(result.current.needsIdentity).toBe(true);
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

  it('ignores success after blur', async () => {
    let resolveRequest!: () => void;
    (submitWalletPin as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { result } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    act(() => result.current.submit());
    expect(submitWalletPin).toHaveBeenCalledTimes(1);
    act(() => mockNavigationListeners.get('blur')?.());
    await act(async () => resolveRequest());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not run Done from an alert after the screen blurs', async () => {
    (submitWalletPin as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    await act(async () => result.current.submit());
    await act(
      async () => new Promise<void>((resolve) => setImmediate(resolve))
    );
    expect(submitWalletPin).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const buttons = (Alert.alert as jest.Mock).mock.calls[0]?.[2] as Array<{
      onPress?: () => void;
    }>;
    act(() => mockNavigationListeners.get('blur')?.());
    act(() => buttons[0]?.onPress?.());
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('ignores a late success after unmount', async () => {
    let resolveRequest!: () => void;
    (submitWalletPin as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    act(() => result.current.submit());
    expect(submitWalletPin).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => resolveRequest());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('does not revive a pending request when focus returns', async () => {
    let resolveRequest!: () => void;
    (submitWalletPin as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { result } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    act(() => result.current.submit());
    expect(submitWalletPin).toHaveBeenCalledTimes(1);
    act(() => mockNavigationListeners.get('blur')?.());
    act(() => mockNavigationListeners.get('focus')?.());
    await act(async () => resolveRequest());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('ignores a pending request after the authenticated user changes', async () => {
    let resolveRequest!: () => void;
    (submitWalletPin as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { result, rerender } = renderHook(() => useWalletPinSettings());
    act(() => {
      result.current.setNewPin('1234');
      result.current.setConfirmPin('1234');
    });
    act(() => result.current.submit());
    expect(submitWalletPin).toHaveBeenCalledTimes(1);
    mockUserId = 'user-2';
    rerender({});
    await act(async () => resolveRequest());
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
