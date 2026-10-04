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
  it('keeps settled interest separate from spendable and savings balances', () => {
    const result = deriveWalletDisplayData({
      balance: 5000,
      earnings_available: true,
      earnings_balance: 125.5,
      savings_balance: 500,
    } as never);

    expect(result.earningsBalance).toBe(125.5);
    expect(result.earningsAvailable).toBe(true);
    expect(result.savingsBalance).toBe(500);
    expect(result.spendableBalance).toBe(5000);
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
    expect(result.spendableBalance).toBe(800);
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
});
