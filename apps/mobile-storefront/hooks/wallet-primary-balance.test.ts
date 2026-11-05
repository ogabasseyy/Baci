import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS,
  primaryBalanceField,
  primaryUnavailableField,
  readPrimaryFundingAccountSoon,
} from './wallet-primary-balance';

const mockRead = jest.fn<() => Promise<unknown>>();
jest.mock('./resolve-wallet-funding-account', () => ({
  readPrimaryFundingAccount: () => mockRead(),
}));

const account = {
  accountName: 'Verified',
  accountNumber: '0987654321',
  bankName: 'Provider Bank',
  provider: 'piggyvest',
} as const;

describe('primaryBalanceField', () => {
  it('exposes the kobo balance only for a ready primary wallet', () => {
    expect(
      primaryBalanceField({ status: 'ready', account, balanceKobo: 123456 })
    ).toEqual({ primary_balance_kobo: 123456 });
    expect(
      primaryBalanceField({ status: 'ready', account, balanceKobo: 0 })
    ).toEqual({ primary_balance_kobo: 0 });
  });

  it('adds nothing for pending, not ready or unavailable settlements', () => {
    expect(
      primaryBalanceField({ status: 'ready', account: null, balanceKobo: null })
    ).toEqual({});
    expect(primaryBalanceField({ status: 'not_ready' })).toEqual({});
    expect(primaryBalanceField({ status: 'unavailable' })).toEqual({});
  });

  it('refuses a malformed balance instead of showing a wrong figure', () => {
    expect(
      primaryBalanceField({ status: 'ready', account, balanceKobo: -5 })
    ).toEqual({});
    expect(
      primaryBalanceField({ status: 'ready', account, balanceKobo: 1.5 })
    ).toEqual({});
  });
});

describe('readPrimaryFundingAccountSoon', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRead.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes a prompt settlement through', async () => {
    mockRead.mockResolvedValue({ status: 'not_ready' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'not_ready',
    });
  });

  it('settles a stalled probe as unavailable after the budget', async () => {
    mockRead.mockReturnValue(new Promise(() => undefined));
    const settled = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await expect(settled).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('primaryUnavailableField', () => {
  it('marks only a transient failure, never an authoritative answer', () => {
    expect(primaryUnavailableField({ status: 'unavailable' })).toEqual({
      primary_unavailable: true,
    });
    expect(primaryUnavailableField({ status: 'not_ready' })).toEqual({});
    expect(
      primaryUnavailableField({
        status: 'ready',
        account: null,
        balanceKobo: null,
      })
    ).toEqual({});
  });
});
