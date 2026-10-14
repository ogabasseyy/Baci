'use client';

import type {
  StorefrontWalletFundingAccount,
  StorefrontWalletTransaction,
} from '@baci/shared';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

interface UseWalletOptions {
  userId: string | undefined;
  merchantSlug: string | undefined;
}

interface UseWalletReturn {
  walletBalance: number;
  /**
   * Live balance reader (Codex R78 6sN80p): purchase handlers close
   * over the render-time balance before the settlement-gate await,
   * so a refetch completing mid-await would evaluate stale. Invoke
   * at gate time instead — it returns the latest rendered balance,
   * including post-fetch and post-purchase updates.
   */
  getWalletBalance: () => number;
  /**
   * Live error reader (Codex R81 P2): a refresh failing during the
   * settlement-gate await must block at gate time, when the
   * render-time walletError snapshot is stale. Published
   * synchronously by the error setter (not render-phase like the
   * balance mirror — error has no external writers, so no lag
   * window is acceptable here).
   */
  getWalletError: () => boolean;
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
  /**
   * Synchronous refresh gate (Codex R35 hyTr): true from the
   * refreshWallet() call until the fetch settles. Read it at submit
   * time — unlike walletLoading (flipped by the fetch effect after
   * render), it has no commit/effect gap for a click to slip
   * through on a stale balance.
   */
  isWalletRefreshPending: () => boolean;
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
  // Set synchronously in refreshWallet; cleared when the fetch
  // settles (aborted successors leave it for the winning fetch).
  const refreshPendingRef = useRef(false);
  // Request generation (Codex R76 6r51Px): claimed synchronously
  // by refreshWallet, captured by each effect run. An older fetch
  // settling in the microtask window before React runs the new
  // effect's cleanup must not clear state for the replacement.
  const fetchGenerationRef = useRef(0);
  // Latest-balance mirror (Codex R78 6sN80p): assigned during render
  // (not in an effect — passive effects can lag the microtask that
  // resumes a settled gate), so any committed render has already
  // published its balance before post-await code can read it. Covers
  // fetch completions AND direct setWalletBalance calls (post-
  // purchase optimistic updates), which no fetch-side hook could see.
  const walletBalanceRef = useRef(walletBalance);
  // Live error mirror (Codex R81 P2): published synchronously by
  // setWalletErrorLive at every write site, so a failure landing
  // mid-await reads true even before React commits the render.
  const walletErrorRef = useRef(false);
  const setWalletErrorLive = (value: boolean) => {
    walletErrorRef.current = value;
    setWalletError(value);
  };

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
    setWalletErrorLive(false);
    setPayWithWallet(false);
    setFundingAccount(null);
    setRequiresFundingAccountConsent(false);
    setWalletDvaEnabled(false);
    setWalletTransactions([]);
  }
  // Publish this render's balance for post-await readers (see above).
  walletBalanceRef.current = walletBalance;

  useEffect(() => {
    const abortController = new AbortController();
    const generation = fetchGenerationRef.current;
    const isSuperseded = () =>
      abortController.signal.aborted ||
      generation !== fetchGenerationRef.current;

    const fetchWalletBalance = () => {
      if (!userId || !merchantSlug) {
        refreshPendingRef.current = false;
        return;
      }

      setWalletLoading(true);
      setWalletErrorLive(false);
      fetch(`/api/storefront/customer/wallet?merchant=${merchantSlug}`, {
        signal: abortController.signal,
      })
        .then(async (response) => {
          if (isSuperseded()) return;
          if (!response.ok) {
            setWalletErrorLive(true);
            return;
          }
          const data = await response.json();
          // Re-check after the await: an identity change fires the effect
          // cleanup (abort) synchronously, so a superseded response that
          // resolved just before the switch won't apply a stale account.
          if (isSuperseded()) return;
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
          if (
            !isSuperseded() &&
            error instanceof Error &&
            error.name !== 'AbortError'
          ) {
            console.error('Failed to fetch wallet balance:', error);
            setWalletErrorLive(true);
          }
        })
        .finally(() => {
          if (!isSuperseded()) {
            setWalletLoading(false);
            refreshPendingRef.current = false;
          }
        });
    };

    fetchWalletBalance();

    return () => abortController.abort();
  }, [userId, merchantSlug, refreshToken]);

  return {
    walletBalance,
    getWalletBalance: () => walletBalanceRef.current,
    getWalletError: () => walletErrorRef.current,
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
    refreshWallet: () => {
      refreshPendingRef.current = true;
      // Claim the next generation NOW, not in the effect: the
      // in-flight fetch may settle before React commits this
      // update, and only a synchronously-bumped generation lets
      // its finally recognize it is superseded.
      fetchGenerationRef.current += 1;
      setRefreshToken((token) => token + 1);
    },
    isWalletRefreshPending: () => refreshPendingRef.current,
  };
}
