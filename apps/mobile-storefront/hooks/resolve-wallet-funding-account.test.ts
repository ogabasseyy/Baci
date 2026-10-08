import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { resolveWalletFundingAccount } from './resolve-wallet-funding-account';

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
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

beforeEach(() => jest.resetAllMocks());

it('displays the confirmed PiggyVest account rather than the legacy account', async () => {
  read.mockResolvedValue({
    account: {
      accountName: 'Verified',
      accountNumber: '0987654321',
      bankName: 'Provider Bank',
      provider: 'piggyvest',
    },
    requiresConsent: false,
    provisioningStatus: 'ready',
  });
  expect(await resolveWalletFundingAccount(legacy, merchantId)).toEqual({
    account_name: 'Verified',
    account_number: '0987654321',
    bank_name: 'Provider Bank',
    provider: 'piggyvest',
  });
});

it('never falls back to Paystack when PiggyVest reads fail', async () => {
  read.mockRejectedValue(new Error('Unavailable'));
  expect(await resolveWalletFundingAccount(legacy, merchantId)).toBeNull();
});

it('keeps the working legacy account when the server reports primary unconfigured', async () => {
  read.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'PIGGYVEST_NOT_READY' })
  );
  expect(await resolveWalletFundingAccount(legacy, merchantId)).toEqual(legacy);
});

it('preserves other merchants accounts without contacting PiggyVest', async () => {
  expect(await resolveWalletFundingAccount(legacy, 'other')).toEqual(legacy);
  expect(read).not.toHaveBeenCalled();
});
