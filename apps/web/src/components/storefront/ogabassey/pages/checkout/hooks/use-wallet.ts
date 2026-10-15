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
import { useWalletFetchCoordination } from './use-wallet-fetch-coordination';

interface UseWalletOptions {
  userId: string | undefined;
  merchantSlug: string | undefined;
}

/**
 * Bounds one balance fetch (headers + body). Without this a stalled
 * response leaves walletLoading true forever, and the mandatory
 * wallet-only gate rejects every purchase while loading — closing
 * the modal does not unmount the hook, so the customer stays blocked
 * until reload. Expiry aborts into the wallet-error state, whose
 * gate retries the fetch (Codex R87 P2).
 */
export const WALLET_BALANCE_FETCH_TIMEOUT_MS = 10_000;

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
  /**
   * Initial-read gate (Codex R103 P2): true from the render-phase
   * identity reset (balance zeroed) until the new identity's first
   * fetch settles. walletLoading flips only inside the passive
   * fetch effect, so without this a submit between commit and
   * effect reads the placeholder zero as a real balance. Read it
   * at submit time like isWalletRefreshPending.
   */
  isWalletInitialReadPending: () => boolean;
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
  // Fetch-generation + pending-flag coordination, extracted per the
  // 300-line ceiling (Codex R104 P1).
  const fetchCoordination = useWalletFetchCoordination();
  const fetchGenerationRef = fetchCoordination.fetchGenerationRef;
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
    fetchCoordination.claimIdentity(identity);
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
    // Deadline expiry (Codex R87 P2): set only when OUR timer fires.
    // A successor refresh/unmount also aborts, but then the
    // generation moved (or the view is gone) — only a timeout with no
    // successor flips to the error state below.
    let fetchTimedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const fetchWalletBalance = () => {
      if (!userId || !merchantSlug) {
        fetchCoordination.settleFetch(generation, {
          fetchTimedOut: false,
          signalAborted: false,
        });
        return;
      }

      setWalletLoading(true);
      setWalletErrorLive(false);
      // Bound headers + body: aborting the signal also rejects a
      // stalled body read, so one timer covers the whole fetch.
      timeoutId = setTimeout(() => {
        fetchTimedOut = true;
        abortController.abort();
      }, WALLET_BALANCE_FETCH_TIMEOUT_MS);
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
          if (generation !== fetchGenerationRef.current) {
            return;
          }
          if (fetchTimedOut) {
            console.error('Wallet balance fetch timed out');
            setWalletErrorLive(true);
            return;
          }
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
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
          if (
            fetchCoordination.settleFetch(generation, {
              fetchTimedOut,
              signalAborted: abortController.signal.aborted,
            })
          ) {
            setWalletLoading(false);
          }
        });
    };

    fetchWalletBalance();

    return () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      abortController.abort();
    };
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
      fetchCoordination.claimRefresh();
      setRefreshToken((token) => token + 1);
    },
    isWalletRefreshPending: fetchCoordination.isRefreshPending,
    isWalletInitialReadPending: fetchCoordination.isInitialReadPending,
  };
}
