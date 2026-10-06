/**
 * Pure helpers for `GET /api/storefront/customer/wallet` — no DB access.
 * Route-private (colocated).
 */

import type { WalletFundingAccountRow } from './wallet-data-types';

export function toNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function formatFundingAccount(row: WalletFundingAccountRow | null) {
  if (row?.provider !== 'paystack') {
    return null;
  }

  return {
    accountName: row.account_name,
    accountNumber: row.account_number,
    bankName: row.bank_name,
    provider: 'paystack',
  };
}

export function emptyWalletResponse({
  earningsAvailable = false,
  earningsBalance = null,
  fundingAccount = null,
  loyaltyPoints = 0,
  requiresFundingAccountConsent,
  savingsBalance = 0,
  usdtBalance = 0,
  walletDvaEnabled = false,
}: {
  earningsAvailable?: boolean;
  earningsBalance?: number | null;
  fundingAccount?: ReturnType<typeof formatFundingAccount>;
  loyaltyPoints?: number;
  requiresFundingAccountConsent?: boolean;
  savingsBalance?: number;
  usdtBalance?: number;
  walletDvaEnabled?: boolean;
} = {}) {
  return {
    balance: 0,
    balances: { NGN: 0, USDT: usdtBalance },
    earningsAvailable,
    earningsBalance,
    fundingAccount,
    hasWallet: usdtBalance > 0,
    loyaltyPoints,
    requiresFundingAccountConsent:
      requiresFundingAccountConsent ?? !fundingAccount,
    savingsBalance,
    totalEarned: 0,
    totalRedeemed: 0,
    transactions: [],
    walletDvaEnabled,
  };
}

export function logOptionalWalletHelperFailure(
  label: string,
  result: PromiseSettledResult<unknown>
) {
  if (result.status === 'rejected') {
    console.error('Customer wallet optional fetch failed', {
      error: result.reason,
      label,
    });
  }
}
