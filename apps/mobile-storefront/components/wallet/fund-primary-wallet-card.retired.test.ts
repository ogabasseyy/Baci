import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { Alert, type AlertButton } from 'react-native';

// Card top-up into the PiggyVest primary wallet is retired server-side
// (410 PRIMARY_CARD_FUNDING_RETIRED before any reservation). When nothing
// is retained on the device, the orchestrator must hand the caller its
// not-ready cue so the regular top-up runs, instead of showing the
// "pending operation retained" alert on every tap.
const mockRead = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockStart = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCapability = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockAlert =
  jest.fn<
    (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: object
    ) => void
  >();
jest.mock('./savings/savings-notifier', () => ({
  savingsNotifier: () => (title: string, message?: string) =>
    mockAlert(title, message),
}));
jest.mock('./savings/notify-savings', () => ({
  notifySavings: (title: string, message?: string) => mockAlert(title, message),
}));
jest.mock('./fund/ask-wallet-fund', () => ({
  askWalletFund: (title: string, message: string, label: string) =>
    (
      jest.requireActual(
        './fund/alert-shaped.test-support'
      ) as typeof import('./fund/alert-shaped.test-support')
    )
      .alertShapedTestBridge(mockAlert)
      .ask(title, message, label),
}));
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    readPending: mockRead,
    start: mockStart,
    recover: mockRecover,
  }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => {
  const actual = jest.requireActual(
    '@/lib/piggyvest-primary-capability'
  ) as typeof import('@/lib/piggyvest-primary-capability');
  return { ...actual, getPiggyvestPrimaryCapability: mockCapability };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: '11111111-1111-4111-8111-111111111111' } }),
  },
}));
const { fundPrimaryWalletCard } =
  require('./fund-primary-wallet-card') as typeof import('./fund-primary-wallet-card');

const input = {
  activeMerchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  fundAmount: '1000',
  user: { id: '11111111-1111-4111-8111-111111111111' },
  resetFundPanel: jest.fn(),
  setIsFundPending: jest.fn(),
  walletReturnTo: '/wallet',
};
const retired = () =>
  Object.assign(new Error('retired'), {
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
// The notice and funding question are inline now: replay both through one
// Alert-shaped spy so these cases keep their titles, copy and button
// presses, while the real iOS alert must stay unused.
const alert = mockAlert;
const iosAlert = jest.spyOn(Alert, 'alert');
afterEach(() => expect(iosAlert).not.toHaveBeenCalled());

beforeEach(() => {
  jest.clearAllMocks();
  mockCapability.mockResolvedValue(true);
  mockRead.mockResolvedValue(null);
  alert.mockImplementation((_title, _message, buttons) => {
    buttons
      ?.find((button) => button.text === 'Authorize one-time charge')
      ?.onPress?.();
  });
});

it('falls back when a replayed placeholder is answered retired', async () => {
  // The pre-call read sees the stale null-operation placeholder, so the
  // capability probe is skipped; the request drops it on the retired
  // answer and the catch re-read finds nothing retained.
  mockRead.mockResolvedValueOnce({ operationId: null });
  mockRead.mockResolvedValue(null);
  mockRecover.mockRejectedValue(retired());
  await expect(fundPrimaryWalletCard(input)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
  expect(mockCapability).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

it('falls back when a new card funding is answered retired', async () => {
  mockStart.mockRejectedValue(retired());
  await expect(fundPrimaryWalletCard(input)).rejects.toMatchObject({
    code: 'PRIMARY_CARD_FUNDING_RETIRED',
  });
  expect(alert).not.toHaveBeenCalledWith(
    'Card funding could not be confirmed',
    expect.anything()
  );
});

it('keeps a saved checkout with an operation ID instead of falling back', async () => {
  // A retained operation may already have charged the card: never route it
  // to the regular top-up, whatever the server answered.
  mockRead.mockResolvedValue({ operationId: 'persisted' });
  mockRecover.mockRejectedValue(retired());
  await fundPrimaryWalletCard(input);
  expect(alert).toHaveBeenCalledWith(
    'Card funding could not be confirmed',
    expect.stringContaining('retained')
  );
});
