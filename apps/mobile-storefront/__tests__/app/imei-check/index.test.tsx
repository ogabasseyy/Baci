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
import { IMEI_SCREEN_PRICE_TEST_FIXTURE as approvedPrice } from './imei-price.test-utils';

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
  // Every verify tap first looks for a kept PiggyVest attempt by hash.
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    `sha256(${value.length})`,
}));

jest.mock('expo-router', () => ({
  // The pay sheet closes when the screen loses focus.
  useNavigation: () => ({ addListener: () => () => undefined }),
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

jest.mock('@/stores/auth-store', () => {
  const state = {
    customer: { id: 'customer-1' },
    merchantId: 'merchant-1',
    session: { access_token: 'token-123' },
  };
  const useAuthStore = (selector: (s: unknown) => unknown) => selector(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import ImeiCheckerScreen from '@/app/imei-check';

// Nothing is preselected (Fable walks 15/16), so these flows pick Full
// Report first, as a customer would.
function renderChoosingFullReport() {
  render(<ImeiCheckerScreen />);
  fireEvent.press(screen.getByText('Full Report'));
}

describe('ImeiCheckerScreen', () => {
  it('renders primary shared service tiers and prices Full Report once chosen', () => {
    render(<ImeiCheckerScreen />);

    expect(screen.getByText('Full Report')).toBeTruthy();
    expect(screen.getByText('Quick ID')).toBeTruthy();
    expect(screen.getByText('Stolen Check')).toBeTruthy();
    expect(screen.getByText('Network Check')).toBeTruthy();
    fireEvent.press(screen.getByText('Full Report'));
    expect(screen.getByText(approvedPrice.fullLabel)).toBeTruthy();
  });

  it('bugfix: a fresh form shows no price before a check is chosen (Fable walks 15/16)', () => {
    render(<ImeiCheckerScreen />);

    // No card is preselected below the fold, so the button names no price.
    expect(screen.queryByText(/Verify Now|Pay ₦/)).toBeNull();
    expect(
      screen.getByRole('radio', { name: /Full Report/ })
    ).toHaveAccessibilityState({ selected: false });
    const button = screen.getByText('Choose a check');
    fireEvent.press(button);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('updates the CTA price when a different service tier is selected', () => {
    render(<ImeiCheckerScreen />);

    fireEvent.press(screen.getByText('More checks'));
    fireEvent.press(screen.getByText('Non-Active Status PRO'));

    expect(screen.getByText(approvedPrice.activationLabel)).toBeTruthy();
  });

  it('handles a pending response and polls it to completion', async () => {
    let releasePoll: () => void = () => undefined;
    const pollHeld = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
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
        // Held until the pending screen was seen (the poll is 1ms away).
        json: () =>
          pollHeld.then(() => ({
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
          })),
        ok: true,
        status: 200,
      } as Response);
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await screen.findByText(/usually under a minute/i);
    releasePoll();
    await screen.findByText('iPhone 13 Pro');
    const firstInit = jest.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(firstInit.body))).toMatchObject({
      clientCapabilities: ['imei-async-v1'],
      device: 'smartphone',
    });
    // Real polling after an asynchronous saved-key check: slow on a busy
    // runner, so more than the default five seconds.
  }, 15_000);

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
    renderChoosingFullReport();

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
    renderChoosingFullReport();

    const input = screen.getByPlaceholderText('Enter 15-digit IMEI');
    expect(screen.getByText('Loading wallet balance...')).toBeTruthy();
    fireEvent.changeText(input, '490154203237518');
    fireEvent.press(screen.getByText('Loading wallet...'));
    fireEvent(input, 'submitEditing');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes to wallet top-up instead of requesting when keyboard submit has insufficient balance', async () => {
    mockWalletBalance = 500;
    renderChoosingFullReport();

    const input = screen.getByPlaceholderText('Enter 15-digit IMEI');
    fireEvent.changeText(input, '490154203237518');
    fireEvent(input, 'submitEditing');

    // The tap first looks for a kept PiggyVest attempt (asynchronous).
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(approvedPrice.topUpFrom500)
    );
    expect(fetch).not.toHaveBeenCalled();
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
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

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
          required: approvedPrice.fullPrice,
          success: false,
        }),
      ok: false,
      status: 402,
    } as Response);
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(approvedPrice.topUpFrom500);
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
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(
        '/wallet?action=fund&requiredAmount=0&returnTo=%2Fimei-check'
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
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Lookup failed; your refund is pending. We will credit you within 24h.'
        )
      ).toBeTruthy();
    });
    expect(mockWalletRefetch).toHaveBeenCalled();

    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

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
    renderChoosingFullReport();

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

    await waitFor(() => {
      expect(screen.getByText(error)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(approvedPrice.fullLabel)).toBeTruthy();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText(approvedPrice.fullLabel));

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
    renderChoosingFullReport();

    // Form is showing: back should leave the screen normally (not prevented).
    expect(mockPreventRemoveState.prevent).toBe(false);

    fireEvent.changeText(
      screen.getByPlaceholderText('Enter 15-digit IMEI'),
      '490154203237518'
    );
    fireEvent.press(screen.getByText(approvedPrice.fullLabel));
    await screen.findByText('iPhone 13 Pro');

    // Result is showing: back-swipe must be intercepted, not pop to home.
    expect(mockPreventRemoveState.prevent).toBe(true);

    // Firing the intercept returns to the checker form instead of leaving.
    act(() => mockPreventRemoveState.callback?.());
    // A fresh form again: no check chosen, so no price shown.
    await screen.findByText('Choose a check');
    expect(screen.queryByText('iPhone 13 Pro')).toBeNull();
  });
});

jest.mock('@/components/imei-check/use-imei-runtime-availability', () => ({
  useImeiRuntimeAvailability: () => ({
    availableTierKeys: null,
    failed: false,
    loading: false,
    retry: () => undefined,
  }),
}));
