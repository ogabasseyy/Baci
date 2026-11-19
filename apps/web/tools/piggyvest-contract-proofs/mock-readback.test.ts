import { describe, expect, it } from 'vitest';
import { interestSettings } from './mock-readback';
import {
  DEFAULT_MOCK_OPTIONS,
  type MockOptions,
  type Wallet,
} from './mock-sandbox-types';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: 'w',
  customerId: 'c',
  name: 'n',
  createdAt: 't',
  balance: 0,
  withdrawalCount: 0,
  lagged: null,
  payoutWalletId: 'business',
  interestEnabled: true,
  staleBalance: null,
  settingsHiddenReads: 0,
  payoutHiddenReads: 0,
  account: '9000000000',
  ...over,
});
const options = (over: Partial<MockOptions> = {}): MockOptions => ({
  ...DEFAULT_MOCK_OPTIONS,
  ...over,
});

describe('interestSettings', () => {
  it('shows the accrual flag and the payout destination', () => {
    expect(interestSettings(wallet(), options(), true)).toEqual({
      enable_interest_accrual: true,
      interest_payout_wallet: 'business',
    });
  });

  it('shows nothing at all in `none` mode, and never the destination in `accrual_only`', () => {
    expect(
      interestSettings(wallet(), options({ payoutReadback: 'none' }), true)
    ).toEqual({});
    expect(
      interestSettings(
        wallet(),
        options({ payoutReadback: 'accrual_only' }),
        true
      )
    ).toEqual({ enable_interest_accrual: true });
  });

  it('lets goal wallets, but not the default wallet, omit the destination on request', () => {
    const omit = options({ goalReadbackOmitsPayout: true });
    expect(interestSettings(wallet(), omit, false)).toEqual({
      enable_interest_accrual: true,
    });
    expect(interestSettings(wallet(), omit, true)).toHaveProperty(
      'interest_payout_wallet'
    );
  });

  it('hides everything while the settings lag lasts, then only the destination while its own lag lasts', () => {
    const w = wallet({ settingsHiddenReads: 1, payoutHiddenReads: 1 });
    expect(interestSettings(w, options(), true)).toEqual({});
    expect(interestSettings(w, options(), true)).toEqual({
      enable_interest_accrual: true,
    });
    expect(interestSettings(w, options(), true)).toHaveProperty(
      'interest_payout_wallet'
    );
  });

  it('does not use up the destination lag on a read that omits the destination anyway', () => {
    const w = wallet({ payoutHiddenReads: 1 });
    interestSettings(w, options({ payoutReadback: 'accrual_only' }), true);
    expect(w.payoutHiddenReads).toBe(1);
  });
});
