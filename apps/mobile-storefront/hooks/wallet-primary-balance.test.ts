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
  onLatePrimaryAnswer,
  REMEMBERED_PRIMARY_READ_TTL_MS,
  recallPrimaryFundingAccount,
  rememberPrimaryFundingAccount,
} from './primary-funding-account-memory';
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
let mockAuthUserId: string | null = 'u';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockAuthUserId ? { id: mockAuthUserId } : null }),
  },
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

  it('settles a stalled probe as unavailable after the budget', async () => {
    mockRead.mockReturnValue(new Promise(() => undefined));
    const settled = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await expect(settled).resolves.toEqual({ status: 'unavailable' });
  });

  it('keeps a late confirmed account and answers the next slow load with it', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mockRead.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const first = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await expect(first).resolves.toEqual({ status: 'unavailable' });
    answer({ status: 'ready', account, balanceKobo: 5_000_000 });
    await Promise.resolve();
    await Promise.resolve();

    // The next load runs slow too: the late answer stands in for it.
    mockRead.mockReturnValueOnce(new Promise(() => undefined));
    const second = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await expect(second).resolves.toEqual({
      status: 'ready',
      account,
      balanceKobo: 5_000_000,
    });
  });

  it('falls back to a confirmed read handed over by the setup sheet', async () => {
    rememberPrimaryFundingAccount('m', 'u', {
      status: 'ready',
      account,
      balanceKobo: 0,
    });
    mockRead.mockResolvedValue({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'ready',
      account,
      balanceKobo: 0,
    });
  });

  it('prefers any fresh answer over the remembered one', async () => {
    rememberPrimaryFundingAccount('m', 'u', {
      status: 'ready',
      account,
      balanceKobo: 1,
    });
    mockRead.mockResolvedValueOnce({
      status: 'ready',
      account,
      balanceKobo: 2,
    });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'ready',
      account,
      balanceKobo: 2,
    });
    // An authoritative not ready clears it: a closed account never returns.
    mockRead.mockResolvedValueOnce({ status: 'not_ready' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'not_ready',
    });
    mockRead.mockResolvedValueOnce({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('never remembers less than a confirmed account', async () => {
    rememberPrimaryFundingAccount('m', 'u', {
      status: 'ready',
      account: null,
      balanceKobo: null,
    });
    mockRead.mockResolvedValue({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('ignores a remembered read after an account switch or once it is old', async () => {
    rememberPrimaryFundingAccount('m', 'u', {
      status: 'ready',
      account,
      balanceKobo: 1,
    });
    mockAuthUserId = 'someone-else';
    mockRead.mockResolvedValue({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'unavailable',
    });

    mockAuthUserId = 'u';
    rememberPrimaryFundingAccount('m', 'u', {
      status: 'ready',
      account,
      balanceKobo: 1,
    });
    jest.advanceTimersByTime(REMEMBERED_PRIMARY_READ_TTL_MS + 1);
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('never lets an older slow read overwrite a newer answer', async () => {
    let oldAnswer: (value: unknown) => void = () => undefined;
    mockRead.mockReturnValueOnce(
      new Promise((resolve) => {
        oldAnswer = resolve;
      })
    );
    const older = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await older;
    // A newer read answers first with the post-contribution balance.
    mockRead.mockResolvedValueOnce({
      status: 'ready',
      account,
      balanceKobo: 4_000_000,
    });
    await readPrimaryFundingAccountSoon('m', 'u');
    // The older read lands late with the stale balance: ignored.
    oldAnswer({ status: 'ready', account, balanceKobo: 5_000_000 });
    await Promise.resolve();
    await Promise.resolve();
    mockRead.mockResolvedValueOnce({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'ready',
      account,
      balanceKobo: 4_000_000,
    });
  });

  it('never lets an older slow read bring back a cleared account', async () => {
    let oldAnswer: (value: unknown) => void = () => undefined;
    mockRead.mockReturnValueOnce(
      new Promise((resolve) => {
        oldAnswer = resolve;
      })
    );
    const older = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await older;
    mockRead.mockResolvedValueOnce({ status: 'not_ready' });
    await readPrimaryFundingAccountSoon('m', 'u');
    oldAnswer({ status: 'ready', account, balanceKobo: 1 });
    await Promise.resolve();
    await Promise.resolve();
    mockRead.mockResolvedValueOnce({ status: 'unavailable' });
    await expect(readPrimaryFundingAccountSoon('m', 'u')).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('announces a confirmed answer that lands after its load gave up', async () => {
    const listener = jest.fn();
    onLatePrimaryAnswer(listener);
    let answer: (value: unknown) => void = () => undefined;
    mockRead.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const load = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await load;
    expect(listener).not.toHaveBeenCalled();
    answer({ status: 'ready', account, balanceKobo: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps announcing past a screen whose reload throws', async () => {
    const later = jest.fn();
    onLatePrimaryAnswer(() => {
      throw new Error('screen gone');
    });
    onLatePrimaryAnswer(later);
    let answer: (value: unknown) => void = () => undefined;
    mockRead.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const load = readPrimaryFundingAccountSoon('m', 'u');
    jest.advanceTimersByTime(PRIMARY_FUNDING_ACCOUNT_TIMEOUT_MS);
    await load;
    answer({ status: 'ready', account, balanceKobo: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('lets a wallet read started after the setup sheet replace its balance', () => {
    const sheet = beginPrimaryRead('m', 'u');
    const wallet = beginPrimaryRead('m', 'u');
    rememberPrimaryFundingAccount(
      'm',
      'u',
      { status: 'ready', account, balanceKobo: 100 },
      sheet
    );
    expect(
      rememberPrimaryFundingAccount(
        'm',
        'u',
        { status: 'ready', account, balanceKobo: 900 },
        wallet
      )
    ).toBe(true);
    expect(recallPrimaryFundingAccount('m', 'u')).toMatchObject({
      balanceKobo: 900,
    });
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
