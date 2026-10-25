import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { Alert } from 'react-native';

// Capture the latest usePreventRemove(preventRemove, callback) args so the
// back-swipe intercept can be asserted and fired without a nav container.
const mockPreventRemoveState: {
  prevent: boolean;
  callback: (() => void) | null;
} = { prevent: false, callback: null };

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const mockWalletRefetch = jest.fn();
let mockWalletBalance = 5000;
let mockWalletIsError = false;
let mockWalletIsLoading = false;

beforeEach(async () => {
  jest.clearAllMocks();
  alertSpy.mockClear();
  mockWalletBalance = 5000;
  mockWalletIsError = false;
  mockWalletIsLoading = false;
  mockWalletRefetch.mockClear();
  global.fetch = jest.fn() as typeof fetch;
  mockPreventRemoveState.prevent = false;
  mockPreventRemoveState.callback = null;
  await AsyncStorage.clear();
});

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    mockPreventRemoveState.prevent = prevent;
    mockPreventRemoveState.callback = callback;
  },
}));

jest.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-1111-4111-8111-111111111111'),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: {
    Screen: () => null,
  },
}));

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/components/ui/AppKeyboardContainer', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn() }),
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: { wallet: { balance: mockWalletBalance } },
    isError: mockWalletIsError,
    isLoading: mockWalletIsLoading,
    refetch: mockWalletRefetch,
  }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      customer: { id: 'customer-1' },
      merchantId: 'merchant-1',
      session: { access_token: 'token-123' },
    }),
}));

import ImeiCheckerScreen from '@/app/imei-check';

describe('ImeiCheckerScreen', () => {
  it('renders primary shared service tiers with Full Report selected', () => {
    render(<ImeiCheckerScreen />);

    expect(screen.getByText('Full Report')).toBeTruthy();
    expect(screen.getByText('Quick ID')).toBeTruthy();
    expect(screen.getByText('Stolen Check')).toBeTruthy();
    expect(screen.getByText('Network Check')).toBeTruthy();
    expect(screen.getByText('Verify Now - ₦1,500')).toBeTruthy();
  });

  it('updates the CTA price when a different service tier is selected', () => {
    render(<ImeiCheckerScreen />);

    fireEvent.press(screen.getByText('More checks'));
    fireEvent.press(screen.getByText('Non-Active Status PRO'));

    expect(screen.getByText('Verify Now - ₦700')).toBeTruthy();
  });

  it('handles a pending response and polls it to completion', async () => {
    jest
      .mocked(fetch)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            lookupId: '11111111-1111-4111-8111-111111111111',
            pollAfterMs: 1,
            status: 'pending',
            success: true,
          }),
        ok: true,
        status: 202,
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: {
              blacklistStatus: 'Clean',
              carrier: 'Unlocked',
              device: 'iPhone 13 Pro',
              deviceImage: '',
              deviceType: 'apple',
              icloud: 'Off',
              icloudLock: 'Off',
              imei: '490154203237518',
              modelNumber: 'A2638',
              score: 98,
              simLock: 'Unlocked',
              status: 'Clean',
              verdict: 'Safe to buy',
              verdictType: 'safe',
            },
            status: 'complete',
            success: true,
          }),
        ok: true,
        status: 200,
      } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await screen.findByText(/usually under a minute/i);
    await screen.findByText('iPhone 13 Pro');
    const firstInit = jest.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(firstInit.body))).toMatchObject({
      clientCapabilities: ['imei-async-v1'],
      device: 'smartphone',
    });
  });

  it('exposes the full catalog: shows the toggle and Samsung checks', () => {
    render(<ImeiCheckerScreen />);

    // The full catalog is public now, so the "show all services" toggle appears.
    expect(screen.getByText('More checks')).toBeTruthy();
    // Selecting a non-Apple brand reveals its checks without needing "show all".
    fireEvent.press(screen.getByText('Samsung'));

    expect(screen.getByText('Quick ID')).toBeTruthy();
    expect(screen.queryByText('Samsung Info')).toBeNull();
    expect(screen.queryByText('Samsung Info PRO')).toBeNull();
    fireEvent.press(screen.getByLabelText('Other options for Device details'));
    expect(screen.getByText('Samsung Info')).toBeTruthy();
    expect(screen.getByText('Samsung Info PRO')).toBeTruthy();
  });

  it('alerts the user and skips the request when an invalid IMEI is submitted', () => {
    render(<ImeiCheckerScreen />);

    const input = screen.getByPlaceholderText('Enter 15-digit IMEI');
    // 15 digits, but the Luhn checksum is invalid so validation returns false.
    fireEvent.changeText(input, '123456789012345');
    fireEvent(input, 'submitEditing');

    expect(alertSpy).toHaveBeenCalledWith(
      'Invalid number',
      expect.stringContaining('valid 15-digit IMEI')
    );
  });

  it('waits for wallet balance before enabling verification', () => {
    mockWalletIsLoading = true;
    render(<ImeiCheckerScreen />);

    const input = screen.getByPlaceholderText('Enter 15-digit IMEI');
    expect(screen.getByText('Loading wallet balance...')).toBeTruthy();
    fireEvent.changeText(input, '490154203237518');
    fireEvent.press(screen.getByText('Loading wallet...'));
    fireEvent(input, 'submitEditing');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes to wallet top-up instead of requesting when keyboard submit has insufficient balance', () => {
    mockWalletBalance = 500;
    render(<ImeiCheckerScreen />);

    const input = screen.getByPlaceholderText('Enter 15-digit IMEI');
    fireEvent.changeText(input, '490154203237518');
    fireEvent(input, 'submitEditing');

    expect(fetch).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith(
      '/wallet?action=fund&requiredAmount=1000&returnTo=/imei-check'
    );
  });

  it('routes unauthenticated customers to login on 401', async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          code: 'AUTH_REQUIRED',
          error: 'Unauthorized',
          success: false,
        }),
      ok: false,
      status: 401,
    } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        '/auth/login?returnTo=/imei-check'
      );
    });
  });

  it('routes to wallet top-up with the required delta on 402', async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          balance: 500,
          code: 'WALLET_INSUFFICIENT',
          error: 'Insufficient wallet balance',
          required: 1500,
          success: false,
        }),
      ok: false,
      status: 402,
    } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        '/wallet?action=fund&requiredAmount=1000&returnTo=/imei-check'
      );
    });
  });

  it('falls back to finite values when 402 balance payload is malformed', async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          balance: 'not-a-number',
          code: 'WALLET_INSUFFICIENT',
          error: 'Insufficient wallet balance',
          required: 'not-a-number',
          success: false,
        }),
      ok: false,
      status: 402,
    } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        '/wallet?action=fund&requiredAmount=0&returnTo=/imei-check'
      );
    });
  });

  it('shows delayed refund copy and refreshes wallet on REFUND_PENDING', async () => {
    jest.mocked(fetch).mockResolvedValue({
      json: () =>
        Promise.resolve({
          code: 'REFUND_PENDING',
          error: 'Refund pending',
          success: false,
        }),
      ok: false,
      status: 502,
    } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Lookup failed; your refund is pending. We will credit you within 24h.'
        )
      ).toBeTruthy();
    });
    expect(mockWalletRefetch).toHaveBeenCalled();

    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    const firstHeaders = (jest.mocked(fetch).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (jest.mocked(fetch).mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;

    expect(secondHeaders['Idempotency-Key']).toBe(
      firstHeaders['Idempotency-Key']
    );
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'DEBIT_FAILURE_STATE_SAVE_FAILED',
      'Lookup failed and debit failure state could not be saved.',
    ],
    [
      'LOOKUP_RESULT_SAVE_FAILED',
      'IMEI lookup completed but the result could not be saved.',
    ],
    [
      'REFUND_STATE_SAVE_FAILED',
      'Lookup failed and refund status could not be saved.',
    ],
    [
      'REFUNDED_STATE_SAVE_FAILED',
      'Lookup failed and refund result could not be saved.',
    ],
  ])('preserves the idempotency key after unresolved %s responses', async (code, error) => {
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    jest
      .mocked(fetch)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            code,
            error,
            success: false,
          }),
        ok: false,
        status: 500,
      } as Response)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: {
              blacklistStatus: 'Clean',
              carrier: 'Unlocked',
              device: 'iPhone 13 Pro',
              deviceImage: '',
              deviceType: 'apple',
              icloud: 'Off',
              icloudLock: 'Off',
              imei: '490154203237518',
              modelNumber: 'A2638',
              score: 98,
              simLock: 'Unlocked',
              status: 'Clean',
              verdict: 'Safe to buy',
              verdictType: 'safe',
            },
            success: true,
          }),
        ok: true,
        status: 200,
      } as Response);
    render(<ImeiCheckerScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(screen.getByText(error)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Verify Now - ₦1,500')).toBeTruthy();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    await screen.findByText('iPhone 13 Pro');

    const firstHeaders = (jest.mocked(fetch).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    const secondHeaders = (jest.mocked(fetch).mock.calls[1][1] as RequestInit)
      .headers as Record<string, string>;

    expect(secondHeaders['Idempotency-Key']).toBe(
      firstHeaders['Idempotency-Key']
    );
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('returns to the checker form when the back-swipe fires while a result is showing', async () => {
    jest.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          data: {
            blacklistStatus: 'Clean',
            carrier: 'Unlocked',
            device: 'iPhone 13 Pro',
            deviceImage: '',
            deviceType: 'apple',
            icloud: 'Off',
            icloudLock: 'Off',
            imei: '490154203237518',
            modelNumber: 'A2638',
            score: 98,
            simLock: 'Unlocked',
            status: 'Clean',
            verdict: 'Safe to buy',
            verdictType: 'safe',
          },
          success: true,
        }),
      ok: true,
      status: 200,
    } as Response);
    render(<ImeiCheckerScreen />);

    // Form is showing: back should leave the screen normally (not prevented).
    expect(mockPreventRemoveState.prevent).toBe(false);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText('Verify Now - ₦1,500'));
    await screen.findByText('iPhone 13 Pro');

    // Result is showing: back-swipe must be intercepted, not pop to home.
    expect(mockPreventRemoveState.prevent).toBe(true);

    // Firing the intercept returns to the checker form instead of leaving.
    act(() => mockPreventRemoveState.callback?.());
    await screen.findByText('Verify Now - ₦1,500');
    expect(screen.queryByText('iPhone 13 Pro')).toBeNull();
  });
});
