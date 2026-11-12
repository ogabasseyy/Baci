import {
  deriveWalletDisplayData,
  normalizeRequiredFundingAccountValue,
} from '@/components/wallet/derive-wallet-display-data';

describe('normalizeRequiredFundingAccountValue', () => {
  it('trims and returns non-empty strings, null otherwise', () => {
    expect(normalizeRequiredFundingAccountValue('  9012345678  ')).toBe(
      '9012345678'
    );
    expect(normalizeRequiredFundingAccountValue('   ')).toBeNull();
    expect(normalizeRequiredFundingAccountValue('')).toBeNull();
    expect(normalizeRequiredFundingAccountValue(null)).toBeNull();
    expect(normalizeRequiredFundingAccountValue(undefined)).toBeNull();
  });
});

describe('deriveWalletDisplayData', () => {
  it('keeps settled interest separate from wallet and savings balances', () => {
    const result = deriveWalletDisplayData({
      balance: 5000,
      earnings_available: true,
      earnings_balance: 125.5,
      savings_balance: 500,
    } as never);

    expect(result.earningsBalance).toBe(125.5);
    expect(result.earningsAvailable).toBe(true);
    expect(result.savingsBalance).toBe(500);
    expect(result.walletBalance).toBe(5000);
    expect(result.totalBalance).toBe(5500);
  });

  it('marks earnings unavailable instead of falling back to wallet deposits', () => {
    const result = deriveWalletDisplayData({
      balance: 800,
      earnings_available: false,
      earnings_balance: null,
      total_balance: 800,
    } as never);

    expect(result.earningsBalance).toBeNull();
    expect(result.earningsAvailable).toBe(false);
    expect(result.walletBalance).toBe(800);
    expect(result.totalBalance).toBe(800);
  });

  it('builds a funding account only when every field is present', () => {
    const complete = deriveWalletDisplayData({
      funding_account: {
        account_name: 'OGB / JOHN DOE',
        account_number: '9012345678',
        bank_name: 'Wema Bank',
        provider: 'paystack',
      },
    });
    expect(complete.fundingAccount).toEqual({
      accountName: 'OGB / JOHN DOE',
      accountNumber: '9012345678',
      bankName: 'Wema Bank',
      provider: 'paystack',
    });

    const partial = deriveWalletDisplayData({
      funding_account: {
        account_number: '9012345678',
        bank_name: 'Wema Bank',
      },
    });
    expect(partial.fundingAccount).toBeNull();
  });

  it('flags quick-save when an active savings goal exists', () => {
    expect(deriveWalletDisplayData({}).showQuickSave).toBe(false);
    expect(
      deriveWalletDisplayData({
        active_savings_goal: { id: 'goal-1' } as never,
      }).showQuickSave
    ).toBe(true);
  });

  it('opens the requested owned goal instead of the first active row', () => {
    const result = deriveWalletDisplayData(
      {
        active_savings_goal: { id: 'goal-1' } as never,
        savings_goals: [{ id: 'goal-1' } as never, { id: 'goal-2' } as never],
      },
      'goal-2'
    );

    expect(result.activeSavingsGoal).toEqual({ id: 'goal-2' });
  });

  it('falls back to the active goal for an unknown requested id', () => {
    const result = deriveWalletDisplayData(
      {
        active_savings_goal: { id: 'goal-1' } as never,
        savings_goals: [{ id: 'goal-1' } as never],
      },
      'goal-unknown'
    );

    expect(result.activeSavingsGoal).toEqual({ id: 'goal-1' });
  });

  it('keeps the active goal when no goal is requested', () => {
    const result = deriveWalletDisplayData({
      active_savings_goal: { id: 'goal-1' } as never,
      savings_goals: [{ id: 'goal-1' } as never, { id: 'goal-2' } as never],
    });

    expect(result.activeSavingsGoal).toEqual({ id: 'goal-1' });
  });

  describe('PiggyVest primary balance', () => {
    it('shows the PiggyVest balance in naira, converted once from kobo', () => {
      const result = deriveWalletDisplayData({
        balance: 5000,
        primary_balance_kobo: 123456,
        savings_balance: 2000,
        total_balance: 7000,
      });

      expect(result.walletBalance).toBe(1234.56);
      expect(result.totalBalance).toBe(3234.56);
      expect(result.savingsBalance).toBe(2000);
      expect(result.primaryReady).toBe(true);
    });

    it('treats a zero PiggyVest balance as ready, not as legacy', () => {
      const result = deriveWalletDisplayData({
        balance: 5000,
        primary_balance_kobo: 0,
      });

      expect(result.walletBalance).toBe(0);
      expect(result.primaryReady).toBe(true);
    });

    it("keeps today's legacy output when there is no primary balance", () => {
      const legacy = {
        balance: 5000,
        savings_balance: 2000,
        total_balance: 7000,
      };
      const result = deriveWalletDisplayData(legacy);

      expect(result.walletBalance).toBe(5000);
      expect(result.totalBalance).toBe(7000);
      expect('primaryReady' in result).toBe(false);
      expect(
        deriveWalletDisplayData({ ...legacy, primary_balance_kobo: null })
      ).toEqual(result);
    });
  });
});

describe('deriveWalletDisplayData legacy balance', () => {
  it('keeps the legacy balance beside the PiggyVest savings wallet balance', () => {
    const data = deriveWalletDisplayData({
      balance: 2000,
      primary_balance_kobo: 0,
    });
    expect(data.walletBalance).toBe(0);
    expect(data.legacyBalance).toBe(2000);
  });
});

describe('bugfix: PiggyVest balance shown as spendable', () => {
  it('never reports PiggyVest money as store credit for a ₦5,000 PiggyVest, ₦0 legacy customer', () => {
    const data = deriveWalletDisplayData({
      balance: 0,
      primary_balance_kobo: 500_000,
      savings_balance: 0,
    });

    // The savings wallet holds the ₦5,000; purchases can spend nothing.
    expect(data.walletBalance).toBe(5000);
    expect(data.legacyBalance).toBe(0);
    expect('spendableBalance' in data).toBe(false);
  });
});
