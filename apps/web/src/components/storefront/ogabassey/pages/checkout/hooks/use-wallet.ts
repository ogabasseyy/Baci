'use client';

import type {
  StorefrontWalletFundingAccount,
  StorefrontWalletTransaction,
} from '@baci/shared';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useState,
} from 'react';

interface UseWalletOptions {
  userId: string | undefined;
  merchantSlug: string | undefined;
}

interface UseWalletReturn {
  walletBalance: number;
  walletLoading: boolean;
  /**
   * True when the last balance fetch failed (network error or non-OK
   * response). Consumers must treat this as "unknown balance" — never as a
   * zero balance — or purchases get blocked as "insufficient funds" when the
   * wallet may actually cover them.
   */
  walletError: boolean;
  payWithWallet: boolean;
  setPayWithWallet: (v: boolean) => void;
  setWalletBalance: Dispatch<SetStateAction<number>>;
  fundingAccount: StorefrontWalletFundingAccount | null;
  requiresFundingAccountConsent: boolean;
  walletDvaEnabled: boolean;
  /**
   * Recent ledger rows. The funding check loop needs them as its pre-transfer
   * baseline — `source_type` is what tells a bank-transfer top-up apart from
   * cashback or a refund.
   */
  walletTransactions: StorefrontWalletTransaction[];
  setFundingAccount: (account: StorefrontWalletFundingAccount | null) => void;
  refreshWallet: () => void;
}

export function useWallet({ userId, merchantSlug }: UseWalletOptions): UseWalletReturn {
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState(false);
  const [payWithWallet, setPayWithWallet] = useState(false);
  const [fundingAccount, setFundingAccount] =
    useState<StorefrontWalletFundingAccount | null>(null);
  const [requiresFundingAccountConsent, setRequiresFundingAccountConsent] =
    useState(false);
  const [walletDvaEnabled, setWalletDvaEnabled] = useState(false);
  const [walletTransactions, setWalletTransactions] = useState<
    StorefrontWalletTransaction[]
  >([]);
  const [refreshToken, setRefreshToken] = useState(0);

  // Clear the previous identity's wallet + funding account SYNCHRONOUSLY
  // (render-phase) when the customer or storefront changes, so consumers
  // never read a stale account number for even one render after a switch.
  // Keyed on identity only — a manual refresh (refreshToken bump) keeps
  // state to avoid a zero-flash. React "adjusting state during render".
  const identity =
    userId && merchantSlug ? `${userId}:${merchantSlug}` : null;
  const [fetchedIdentity, setFetchedIdentity] = useState<string | null>(null);
  if (identity !== fetchedIdentity) {
    setFetchedIdentity(identity);
    setWalletBalance(0);
    setWalletError(false);
    setPayWithWallet(false);
    setFundingAccount(null);
    setRequiresFundingAccountConsent(false);
    setWalletDvaEnabled(false);
    setWalletTransactions([]);
  }

  useEffect(() => {
    const abortController = new AbortController();

    const fetchWalletBalance = () => {
      if (!userId || !merchantSlug) return;

      setWalletLoading(true);
      setWalletError(false);
      fetch(`/api/storefront/customer/wallet?merchant=${merchantSlug}`, {
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (abortController.signal.aborted) return;
          if (!response.ok) {
            setWalletError(true);
            return;
          }
          const data = await response.json();
          // Re-check after the await: an identity change fires the effect
          // cleanup (abort) synchronously, so a superseded response that
          // resolved just before the switch won't apply a stale account.
          if (abortController.signal.aborted) return;
          const balance = Number(data.balance) || 0;
          setWalletBalance(balance);
          setFundingAccount(data.fundingAccount ?? null);
          setRequiresFundingAccountConsent(
            data.requiresFundingAccountConsent === true
          );
          setWalletDvaEnabled(data.walletDvaEnabled === true);
          setWalletTransactions(
            Array.isArray(data.transactions) ? data.transactions : []
          );
          if (balance > 0) {
            setPayWithWallet(true);
          }
        })
        .catch((error) => {
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error('Failed to fetch wallet balance:', error);
            setWalletError(true);
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setWalletLoading(false);
          }
        });
    };

    fetchWalletBalance();

    return () => abortController.abort();
  }, [userId, merchantSlug, refreshToken]);

  return {
    walletBalance,
    walletLoading,
    walletError,
    payWithWallet,
    setPayWithWallet,
    setWalletBalance,
    fundingAccount,
    requiresFundingAccountConsent,
    walletDvaEnabled,
    walletTransactions,
    setFundingAccount: (account) => {
      setFundingAccount(account);
      setRequiresFundingAccountConsent(!account);
    },
    refreshWallet: () => setRefreshToken((token) => token + 1),
  };
}
