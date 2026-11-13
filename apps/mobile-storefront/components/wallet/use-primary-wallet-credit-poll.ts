import { useEffect, useRef } from 'react';
import { notifySavings } from './savings/notify-savings';

export const PRIMARY_CREDIT_POLL_INTERVAL_MS = 10_000;
export const PRIMARY_CREDIT_POLL_MAX_MS = 5 * 60_000;

interface UsePrimaryWalletCreditPollInput {
  /** PiggyVest main-wallet balance in kobo; null/undefined when not ready. */
  balanceKobo: number | null | undefined;
  /** Fund panel open AND the server said the main wallet is ready. */
  enabled: boolean;
  /** Restarts the watch (new baseline) when the signed-in account changes. */
  scopeKey: string;
  refetch: () => unknown;
}

/**
 * PiggyVest bank transfers into the main wallet never appear in the legacy
 * transaction list the credit watch reads. While the fund panel is open on a
 * ready main wallet, refetch every 10s for at most 5 minutes and announce
 * (as the wallet notice) once when the balance rises above its value at open.
 */
export function usePrimaryWalletCreditPoll({
  balanceKobo,
  enabled,
  scopeKey,
  refetch,
}: UsePrimaryWalletCreditPollInput) {
  const balanceRef = useRef(balanceKobo);
  const refetchRef = useRef(refetch);
  const baselineRef = useRef<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const announcedRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    balanceRef.current = balanceKobo;
    refetchRef.current = refetch;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: scopeKey only restarts the watch for a different account.
  useEffect(() => {
    if (!enabled) return;
    baselineRef.current =
      typeof balanceRef.current === 'number' ? balanceRef.current : null;
    announcedRef.current = false;
    inFlightRef.current = false;
    const interval = setInterval(() => {
      // A refresh still running is left alone: restarting it every tick would
      // cancel a slow but successful load before it can publish.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      // Refetch failures are transient; the next tick tries again.
      Promise.resolve(refetchRef.current())
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current = false;
        });
    }, PRIMARY_CREDIT_POLL_INTERVAL_MS);
    const deadline = setTimeout(
      () => clearInterval(interval),
      PRIMARY_CREDIT_POLL_MAX_MS
    );
    const stop = () => {
      clearInterval(interval);
      clearTimeout(deadline);
    };
    stopRef.current = stop;
    return () => {
      stop();
      stopRef.current = null;
      baselineRef.current = null;
    };
  }, [enabled, scopeKey]);

  useEffect(() => {
    const baseline = baselineRef.current;
    if (
      !enabled ||
      announcedRef.current ||
      typeof balanceKobo !== 'number' ||
      // A pending account opened with no balance (Codex): its first
      // positive balance is the money received.
      balanceKobo <= (baseline ?? 0)
    ) {
      return;
    }
    announcedRef.current = true;
    stopRef.current?.();
    // The inset wallet notice: inline in the add money sheet while it is
    // open, and on the wallet once it closes. Never an iOS alert.
    notifySavings(
      'Money received',
      'Your savings wallet balance has been updated.',
      'success'
    );
  }, [balanceKobo, enabled]);
}
