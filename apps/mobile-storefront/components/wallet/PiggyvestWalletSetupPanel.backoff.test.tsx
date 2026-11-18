// Automatic account-number checks keep going on a bounded backoff: PiggyVest
// can take over a minute to issue the account number (production, 11-16).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@/hooks/primary-funding-account-memory', () => ({
  beginPrimaryRead: () => 7,
  rememberPrimaryFundingAccount: jest.fn(),
}));

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { create: jest.fn(), read: jest.fn() },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) => selector({ user: { id: 'user-a-id' } }),
}));

const pending = {
  provisioningStatus: 'pending' as const,
  requiresConsent: false,
  account: null,
};
const ready = {
  provisioningStatus: 'ready' as const,
  requiresConsent: false,
  account: {
    accountNumber: '0123456789',
    bankName: 'POCKETAPP',
    accountName: 'Ogabassey Services Limited/Bassey John',
    provider: 'piggyvest' as const,
  },
  balanceKobo: 0,
};

const read = jest.mocked(piggyvestPrimaryWalletApi.read);

/** Advances fake time one second at a time, letting each check settle. */
async function waitSeconds(seconds: number) {
  for (let second = 0; second < seconds; second += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
}

async function startSetup(onRefresh = jest.fn()) {
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue(pending);
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.light}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await screen.findByText('Setting up your account number');
  // Reads from here on are automatic checks, not the sheet's first read.
  return read.mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  read.mockResolvedValue(pending);
});

afterEach(() => {
  jest.useRealTimers();
});

it('keeps checking past one minute without asking the customer to tap', async () => {
  const before = await startSetup();

  await waitSeconds(60);
  const byOneMinute = read.mock.calls.length - before;
  await waitSeconds(60);

  expect(read.mock.calls.length - before).toBeGreaterThan(byOneMinute);
  expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  expect(screen.queryByText(/taking longer than usual/)).toBeNull();
});

it('stops after about five minutes and then offers Check now', async () => {
  const before = await startSetup();

  await waitSeconds(5 * 60 + 5);
  const checks = read.mock.calls.length - before;
  expect(checks).toBe(22);
  expect(screen.getByText(/taking longer than usual/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Check now' })).toBeOnTheScreen();

  await waitSeconds(60);
  expect(read.mock.calls.length - before).toBe(checks);
});

it('opens the account as soon as a late check returns it', async () => {
  const onRefresh = jest.fn();
  const before = await startSetup(onRefresh);
  // Ready on the 8th check, 91 seconds in (3 + 5 + 8 + 5 × 15).
  for (let check = 1; check < 8; check += 1)
    read.mockResolvedValueOnce(pending);
  read.mockResolvedValueOnce(ready);

  await waitSeconds(90);
  expect(onRefresh).not.toHaveBeenCalled();
  await waitSeconds(2);

  expect(read.mock.calls.length - before).toBe(8);
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
});
