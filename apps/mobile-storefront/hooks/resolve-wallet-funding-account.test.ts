import { clearPiggyvestPrimaryCapabilityCache } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import {
  readPrimaryFundingAccount,
  resolveWalletFundingAccount,
} from './resolve-wallet-funding-account';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));

let mockUserId: string | undefined;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockUserId ? { id: mockUserId } : undefined }),
  },
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const userId = '11111111-1111-4111-8111-111111111111';
const legacy = {
  account_name: 'Legacy',
  account_number: '1234567890',
  bank_name: 'Wema Bank',
  provider: 'paystack',
};
const primaryAccount = {
  accountName: 'Verified',
  accountNumber: '0987654321',
  bankName: 'Provider Bank',
  provider: 'piggyvest',
} as const;
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

beforeEach(() => {
  jest.resetAllMocks();
  clearPiggyvestPrimaryCapabilityCache();
  mockUserId = userId;
});

it('displays the confirmed PiggyVest account rather than the legacy account', async () => {
  read.mockResolvedValue({
    account: primaryAccount,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  const primary = await readPrimaryFundingAccount(merchantId, userId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual({
    account_name: 'Verified',
    account_number: '0987654321',
    bank_name: 'Provider Bank',
    provider: 'piggyvest',
  });
});

it('settles failed reads as unavailable instead of throwing the wallet load', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  await expect(readPrimaryFundingAccount(merchantId, userId)).resolves.toEqual({
    status: 'unavailable',
  });
});

it('keeps the last-known legacy account when PiggyVest reads fail', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  const primary = await readPrimaryFundingAccount(merchantId, userId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual(
    legacy
  );
});

it('keeps the working legacy account when the server reports primary unconfigured', async () => {
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  const primary = await readPrimaryFundingAccount(merchantId, userId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual(
    legacy
  );
});

it('resolves no account for freshly onboarded customers without legacy rows', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  const primary = await readPrimaryFundingAccount(merchantId, userId);
  expect(resolveWalletFundingAccount(null, merchantId, primary)).toBeNull();
});

it('preserves other merchants accounts while caching the negative probe', async () => {
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  const primary = await readPrimaryFundingAccount('other', userId);
  expect(resolveWalletFundingAccount(legacy, 'other', primary)).toEqual(legacy);
  expect(read).toHaveBeenCalledTimes(1);
  await readPrimaryFundingAccount('other', userId);
  expect(read).toHaveBeenCalledTimes(1);
});

it('resolves a server-enabled merchant on first load via one probe', async () => {
  read.mockResolvedValue({
    account: primaryAccount,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  const primary = await readPrimaryFundingAccount(
    '00000000-0000-4000-8000-000000000000',
    userId
  );
  expect(
    resolveWalletFundingAccount(
      legacy,
      '00000000-0000-4000-8000-000000000000',
      primary
    )
  ).toEqual({
    account_name: 'Verified',
    account_number: '0987654321',
    bank_name: 'Provider Bank',
    provider: 'piggyvest',
  });
  // The probe's own snapshot answers: no second account read.
  expect(read).toHaveBeenCalledTimes(1);
});

it('treats an ambiguous probe failure as unavailable and retries next load', async () => {
  read.mockRejectedValueOnce(new Error('timeout'));
  await expect(readPrimaryFundingAccount('other', userId)).resolves.toEqual({
    status: 'unavailable',
  });
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  await readPrimaryFundingAccount('other', userId);
  expect(read).toHaveBeenCalledTimes(2);
});

it('never shows the previous users account after an account switch', async () => {
  const merchant = '00000000-0000-4000-8000-000000000002';
  const accountB = {
    accountName: 'User B',
    accountNumber: '0222222222',
    bankName: 'Provider Bank',
    provider: 'piggyvest',
  } as const;
  // User A loads first: probe snapshot answers with A's account and caches
  // the merchant verdict.
  read.mockResolvedValueOnce({
    account: primaryAccount,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  mockUserId = 'user-a';
  const first = await readPrimaryFundingAccount(merchant, 'user-a');
  expect(first).toEqual({ status: 'ready', account: primaryAccount });
  // User B loads after the switch: the cached verdict carries no snapshot,
  // so B's load re-reads under B's session instead of reusing A's account.
  read.mockResolvedValueOnce({
    account: accountB,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  mockUserId = 'user-b';
  const second = await readPrimaryFundingAccount(merchant, 'user-b');
  expect(read).toHaveBeenLastCalledWith(merchant, 'user-b');
  expect(second).toEqual({ status: 'ready', account: accountB });
  expect(resolveWalletFundingAccount(legacy, merchant, second)).toEqual({
    account_name: 'User B',
    account_number: '0222222222',
    bank_name: 'Provider Bank',
    provider: 'piggyvest',
  });
  expect(read).toHaveBeenCalledTimes(2);
});

it('refuses to fetch when the session already disagrees with the caller', async () => {
  mockUserId = 'user-b';
  await expect(readPrimaryFundingAccount(merchantId, userId)).resolves.toEqual({
    status: 'unavailable',
  });
  expect(read).not.toHaveBeenCalled();
});

it('rejects a direct-read snapshot that lands after a mid-flight switch', async () => {
  read.mockImplementation(async () => {
    mockUserId = 'user-b';
    return {
      account: primaryAccount,
      requiresConsent: false,
      provisioningStatus: 'ready',
    };
  });
  await expect(readPrimaryFundingAccount(merchantId, userId)).resolves.toEqual({
    status: 'unavailable',
  });
});

it('rejects a probe snapshot that lands after a mid-flight switch', async () => {
  const merchant = '00000000-0000-4000-8000-000000000003';
  read.mockImplementation(async () => {
    mockUserId = 'user-b';
    return {
      account: primaryAccount,
      requiresConsent: false,
      provisioningStatus: 'ready',
    };
  });
  await expect(readPrimaryFundingAccount(merchant, userId)).resolves.toEqual({
    status: 'unavailable',
  });
});
