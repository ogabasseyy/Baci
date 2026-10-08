import { clearPiggyvestPrimaryCapabilityCache } from '@/lib/piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import {
  readPrimaryFundingAccount,
  resolveWalletFundingAccount,
} from './resolve-wallet-funding-account';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
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
});

it('displays the confirmed PiggyVest account rather than the legacy account', async () => {
  read.mockResolvedValue({
    account: primaryAccount,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  const primary = await readPrimaryFundingAccount(merchantId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual({
    account_name: 'Verified',
    account_number: '0987654321',
    bank_name: 'Provider Bank',
    provider: 'piggyvest',
  });
});

it('settles failed reads as unavailable instead of throwing the wallet load', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  await expect(readPrimaryFundingAccount(merchantId)).resolves.toEqual({
    status: 'unavailable',
  });
});

it('keeps the last-known legacy account when PiggyVest reads fail', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  const primary = await readPrimaryFundingAccount(merchantId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual(
    legacy
  );
});

it('keeps the working legacy account when the server reports primary unconfigured', async () => {
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  const primary = await readPrimaryFundingAccount(merchantId);
  expect(resolveWalletFundingAccount(legacy, merchantId, primary)).toEqual(
    legacy
  );
});

it('resolves no account for freshly onboarded customers without legacy rows', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  const primary = await readPrimaryFundingAccount(merchantId);
  expect(resolveWalletFundingAccount(null, merchantId, primary)).toBeNull();
});

it('preserves other merchants accounts while caching the negative probe', async () => {
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  const primary = await readPrimaryFundingAccount('other');
  expect(resolveWalletFundingAccount(legacy, 'other', primary)).toEqual(legacy);
  expect(read).toHaveBeenCalledTimes(1);
  await readPrimaryFundingAccount('other');
  expect(read).toHaveBeenCalledTimes(1);
});

it('resolves a server-enabled merchant on first load via one probe', async () => {
  read.mockResolvedValue({
    account: primaryAccount,
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  const primary = await readPrimaryFundingAccount(
    '00000000-0000-4000-8000-000000000000'
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
});

it('treats an ambiguous probe failure as unavailable and retries next load', async () => {
  read.mockRejectedValueOnce(new Error('timeout'));
  await expect(readPrimaryFundingAccount('other')).resolves.toEqual({
    status: 'unavailable',
  });
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  await readPrimaryFundingAccount('other');
  expect(read).toHaveBeenCalledTimes(2);
});
