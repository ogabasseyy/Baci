import { useEffect, useRef, useState } from 'react';
import { usdtWalletFundingApi } from './usdt-wallet-funding-api';

export const USDT_POLL_INTERVAL_MS = 5_000;
export const MAX_USDT_POLL_ATTEMPTS = 60;

export interface UsdtFundingState {
  address: string | null;
  reference: string;
  status: string;
}

type UsdtChain = 'AVAXC' | 'ETH' | 'MATIC' | 'TRX';

interface UseUsdtWalletFundingPollingOptions {
  funding: UsdtFundingState | null;
  merchantSlug: string;
  onAmountChange: (amount: string) => void;
  onChainChange: (chain: UsdtChain) => void;
  onFunded: () => void;
  onFundingChange: (
    updater: (current: UsdtFundingState | null) => UsdtFundingState | null
  ) => void;
}

export function useUsdtWalletFundingPolling({
  funding,
  merchantSlug,
  onAmountChange,
  onChainChange,
  onFunded,
  onFundingChange,
}: UseUsdtWalletFundingPollingOptions) {
  const [pollingExhausted, setPollingExhausted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const callbacksRef = useRef({
    onAmountChange,
    onChainChange,
    onFunded,
    onFundingChange,
  });
  callbacksRef.current = {
    onAmountChange,
    onChainChange,
    onFunded,
    onFundingChange,
  };

  const reference = funding?.reference;
  const status = funding?.status;

  // biome-ignore lint/correctness/useExhaustiveDependencies: pollGeneration intentionally restarts polling when the user requests a manual retry.
  useEffect(() => {
    if (!reference || status !== 'pending') {
      setPollingExhausted(false);
      return;
    }

    setPollingExhausted(false);
    let cancelled = false;
    let inFlight = false;
    let attempts = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const refresh = async () => {
      if (cancelled || inFlight) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (attempts >= MAX_USDT_POLL_ATTEMPTS) {
        stopPolling();
        if (!cancelled) setPollingExhausted(true);
        return;
      }
      attempts += 1;
      inFlight = true;
      if (!cancelled) setChecking(true);
      try {
        const result = await usdtWalletFundingApi.status(
          reference,
          merchantSlug
        );
        if (cancelled || result.kind !== 'ready') return;
        if (result.amount !== null) {
          callbacksRef.current.onAmountChange(String(result.amount));
        }
        if (
          result.chain === 'AVAXC' ||
          result.chain === 'ETH' ||
          result.chain === 'MATIC' ||
          result.chain === 'TRX'
        ) {
          callbacksRef.current.onChainChange(result.chain);
        }
        callbacksRef.current.onFundingChange((current) =>
          current
            ? {
                ...current,
                address: result.depositAddress ?? current.address,
                status: result.fundingStatus,
              }
            : current
        );
        if (result.fundingStatus === 'completed') {
          stopPolling();
          callbacksRef.current.onFunded();
        } else if (result.fundingStatus !== 'pending') {
          stopPolling();
        }
      } finally {
        inFlight = false;
        if (!cancelled) {
          setChecking(false);
          if (attempts >= MAX_USDT_POLL_ATTEMPTS) {
            stopPolling();
            setPollingExhausted(true);
          }
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    void refresh();
    interval = setInterval(refresh, USDT_POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      cancelled = true;
      stopPolling();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [merchantSlug, pollGeneration, reference, status]);

  const restartPolling = () => {
    setPollingExhausted(false);
    setPollGeneration((current) => current + 1);
  };

  return { checking, pollingExhausted, restartPolling };
}
