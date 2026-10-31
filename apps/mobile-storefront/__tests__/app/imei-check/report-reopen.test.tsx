import { beforeEach, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { cleanResult } from '@/components/imei-check/imei-result.test-fixture';

// Capture the latest usePreventRemove(preventRemove, callback) args so the
// back-swipe intercept can be asserted and fired without a nav container.
const mockPreventRemoveState: {
  prevent: boolean;
  callback: (() => void) | null;
} = { prevent: false, callback: null };

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
const mockSecureEntries = new Map<string, string>();
const mockWalletRefetch = jest.fn();
let mockWalletBalance = 5000;
let mockUserId = 'user-a';
let mockWalletIsError = false;
let mockWalletIsLoading = false;

beforeEach(async () => {
  jest.clearAllMocks();
  alertSpy.mockClear();
  mockWalletBalance = 5000;
  mockUserId = 'user-a';
  mockWalletIsError = false;
  mockWalletIsLoading = false;
  mockWalletRefetch.mockClear();
  global.fetch = jest.fn() as typeof fetch;
  mockPreventRemoveState.prevent = false;
  mockPreventRemoveState.callback = null;
  mockSecureEntries.clear();
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

jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecureEntries.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureEntries.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureEntries.delete(key);
  },
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
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
      session: { access_token: 'token-123', user: { id: mockUserId } },
    }),
}));

import ImeiCheckerScreen from '@/app/imei-check';

it('reopens an existing SIM Lock report and completes the blacklist upsell with mocked checkout only', async () => {
  const report = {
    lookupId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-31T00:00:00Z',
    tier: 'simLock',
    device: 'smartphone',
    result: { ...cleanResult, blacklistStatus: 'Unknown' },
  };
  const mockedFetch = jest.mocked(fetch);
  mockedFetch.mockImplementation(async (input, init) => {
    if (String(input).includes('/reports?'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ reports: [report], hasMore: false }),
      } as Response;
    if (init?.method === 'POST')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          status: 'complete',
          lookupId: report.lookupId,
          data: cleanResult,
        }),
      } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        availableTierKeys: ['full', 'simLock', 'blacklist'],
      }),
    } as Response;
  });
  render(<ImeiCheckerScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Open SIM Lock report for iPhone 13 Pro',
    })
  );
  await screen.findByText('iPhone 13 Pro');
  expect(
    mockedFetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  ).toHaveLength(0);
  fireEvent.press(
    await screen.findByRole('button', { name: 'Check blacklist status · ₦700' })
  );
  await screen.findByText('Safe to buy');
  const posts = mockedFetch.mock.calls.filter(
    ([, init]) => init?.method === 'POST'
  );
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]?.[1]?.body as string)).toMatchObject({
    tier: 'blacklist',
    imei: report.result.imei,
    device: 'smartphone',
  });
});

it('hides old history immediately if session changes before customer hydration', async () => {
  jest.mocked(fetch).mockImplementation(
    async (input) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          String(input).includes('/reports?')
            ? {
                reports: [
                  {
                    lookupId: '11111111-1111-4111-8111-111111111111',
                    createdAt: '2026-10-31T00:00:00Z',
                    tier: 'simLock',
                    device: 'smartphone',
                    result: cleanResult,
                  },
                ],
                hasMore: false,
              }
            : { availableTierKeys: ['full', 'blacklist', 'simLock'] },
      }) as Response
  );
  const view = render(<ImeiCheckerScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  await screen.findByRole('button', {
    name: 'Open SIM Lock report for iPhone 13 Pro',
  });
  jest.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  mockUserId = 'user-b';
  view.rerender(<ImeiCheckerScreen />);
  expect(
    screen.queryByRole('button', {
      name: 'Open SIM Lock report for iPhone 13 Pro',
    })
  ).toBeNull();
});

it('hardware back cannot clear a retained report or pending paid follow-up', async () => {
  const report = {
    lookupId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-31T00:00:00Z',
    tier: 'simLock',
    device: 'smartphone',
    result: { ...cleanResult, blacklistStatus: 'Unknown' },
  };
  jest.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('/reports?'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ reports: [report], hasMore: false }),
      } as Response;
    if (
      init?.method === 'POST' ||
      String(input).includes(`/imei-check/${report.lookupId}`)
    )
      return {
        ok: true,
        status: 202,
        json: async () => ({
          success: true,
          status: 'pending',
          lookupId: report.lookupId,
          pollAfterMs: 60000,
        }),
      } as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        availableTierKeys: ['full', 'simLock', 'blacklist'],
      }),
    } as Response;
  });
  render(<ImeiCheckerScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'My completed reports' }));
  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Open SIM Lock report for iPhone 13 Pro',
    })
  );
  fireEvent.press(
    await screen.findByRole('button', { name: 'Check blacklist status · ₦700' })
  );
  await screen.findByText("We're checking");
  act(() => mockPreventRemoveState.callback?.());
  expect(screen.getByText('iPhone 13 Pro')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Check blacklist status · ₦700' })
  ).toBeDisabled();
  expect(
    jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')
  ).toHaveLength(1);
});
