import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  beginPrimaryRead,
  forgetRememberedPrimaryFundingAccounts,
  rememberPrimaryFundingAccount,
} from './primary-funding-account-memory';
import {
  PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS,
  primaryBalanceField,
  primaryStaleField,
  primaryUnavailableField,
  readPrimaryFundingAccountSoon,
} from './wallet-primary-balance';

/** Remembers an answer as the newest read, as a fresh read would. */
const _rememberNow = (
  value: Parameters<typeof rememberPrimaryFundingAccount>[2]
) => rememberPrimaryFundingAccount('m', 'u', value, beginPrimaryRead('m', 'u'));

const mockRead = jest.fn<() => Promise<unknown>>();
jest.mock('./resolve-wallet-funding-account', () => ({
  readPrimaryFundingAccount: () => mockRead(),
}));
let mockAuthUserId: string | null = 'u';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockAuthUserId ? { id: mockAuthUserId } : null }),
  },
}));

/** Lets a late answer run through the read's settle and store steps. */
async function _flushAnswer() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

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
    mockAuthUserId = 'u';
    forgetRememberedPrimaryFundingAccounts();
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

  it('clears its budget timer when the probe fails', async () => {
    mockRead.mockRejectedValueOnce(new Error('network'));
    await expect(readPrimaryFundingAccountSoon('m', 'u')).rejects.toThrow(
      'network'
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles a stalled probe as unavailable after the budget', async () => {
    mockRead.mockReturnValue(new Promise(() => undefined));
    const settled = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await expect(settled).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('primaryStaleField', () => {
  it('marks only a recalled stand-in, never a fresh answer', () => {
    expect(
      primaryStaleField({
        status: 'ready',
        account,
        balanceKobo: 1,
        recalled: true,
      })
    ).toEqual({ primary_stale: true });
    expect(
      primaryStaleField({ status: 'ready', account, balanceKobo: 1 })
    ).toEqual({});
    expect(primaryStaleField({ status: 'unavailable' })).toEqual({});
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
