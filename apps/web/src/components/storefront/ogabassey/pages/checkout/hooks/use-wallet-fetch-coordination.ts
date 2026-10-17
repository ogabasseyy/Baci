import { type MutableRefObject, useRef } from 'react';

/**
 * Fetch-generation + pending-flag coordination for `useWallet`,
 * extracted per the 300-line ceiling (Codex R104 P1).
 *
 * Three races converge here, all closed by claiming synchronously
 * (render-phase or event-handler) instead of inside the passive
 * fetch effect:
 *
 * - Generation (Codex R76 6r51Px): an older fetch settling in the
 *   microtask window before React runs the new effect's cleanup
 *   must not clear state for the replacement. Claimed by refreshes
 *   AND identity changes; each effect run captures its value and
 *   yields when a newer generation exists.
 * - Refresh-pending (Codex R35 hyTr): true from `refreshWallet()`
 *   until the fetch settles. Read at submit time — unlike
 *   `walletLoading` (flipped by the fetch effect after render), it
 *   has no commit/effect gap for a click to slip through on a
 *   stale balance.
 * - Initial-read-pending (Codex R103 P2): true from the
 *   render-phase identity reset (balance zeroed) until the new
 *   identity's first fetch settles. `walletLoading` flips only
 *   inside the passive fetch effect, so without this a submit
 *   between commit and effect reads the placeholder zero as a
 *   real balance.
 */
export function useWalletFetchCoordination(): {
  /**
   * Claim for an identity change. Bumps the generation AND raises
   * initial-read-pending for non-null identities (a null identity
   * schedules no fetch — upstream auth gates own that state).
   */
  claimIdentity: (identity: string | null) => void;
  /**
   * Claim for a manual refresh. Raises refresh-pending AND bumps
   * the generation NOW, not in the effect: the in-flight fetch may
   * settle before React commits this update, and only a
   * synchronously-bumped generation lets its finally recognize it
   * is superseded.
   */
  claimRefresh: () => void;
  /** Current generation; effect runs capture it to detect supersede. */
  fetchGenerationRef: MutableRefObject<number>;
  /** Submit-time reader for the initial-read gate. */
  isInitialReadPending: () => boolean;
  /** Submit-time reader for the refresh gate. */
  isRefreshPending: () => boolean;
  /**
   * Settle accounting for one fetch completion. Clears the pending
   * flags when this generation owns the outcome and reports
   * whether the caller should clear loading alongside (same
   * condition): a plain non-superseded finish, OR a timeout abort
   * with no successor — a timeout looks superseded (signal
   * aborted) but nothing else will clear the pending state, so
   * without the second arm loading stays true until reload.
   */
  settleFetch: (
    generation: number,
    outcome: { fetchTimedOut: boolean; signalAborted: boolean }
  ) => boolean;
} {
  // Set synchronously by claimRefresh; cleared when the fetch
  // settles (aborted successors leave it for the winning fetch).
  const refreshPendingRef = useRef(false);
  // Claimed synchronously in the render-phase identity reset (a
  // fetch effect cannot cover the commit/effect gap), cleared when
  // the current generation's first fetch settles — success, error,
  // or timeout alike.
  const initialReadPendingRef = useRef(false);
  const fetchGenerationRef = useRef(0);

  const claimRefresh = (): void => {
    refreshPendingRef.current = true;
    fetchGenerationRef.current += 1;
  };

  const claimIdentity = (identity: string | null): void => {
    if (identity !== null) {
      // A fetch is now due for an identity whose balance reads
      // zero: block submits until it settles (see above).
      initialReadPendingRef.current = true;
    }
    // Claimed commit-synchronously from the caller's layout effect
    // (Codex R95 P1, R133 P2 — same timing class as claimRefresh):
    // the old passive effect's cleanup runs only after this render
    // commits, so a previous-account response resolving in between
    // would otherwise see an un-superseded generation and
    // repopulate the new session with the previous customer's
    // balance and funding account. Layout — not render-phase, not
    // passive: nothing interleaves between commit and layout, and
    // abandoned renders never run layout effects (a render-phase
    // claim would poison the committed generation on abandonment).
    fetchGenerationRef.current += 1;
  };

  const settleFetch = (
    generation: number,
    outcome: { fetchTimedOut: boolean; signalAborted: boolean }
  ): boolean => {
    const superseded =
      outcome.signalAborted ||
      generation !== fetchGenerationRef.current;
    const ownsOutcome =
      !superseded ||
      (outcome.fetchTimedOut &&
        generation === fetchGenerationRef.current);
    if (ownsOutcome) {
      refreshPendingRef.current = false;
      initialReadPendingRef.current = false;
    }
    return ownsOutcome;
  };

  return {
    claimIdentity,
    claimRefresh,
    fetchGenerationRef,
    isInitialReadPending: () => initialReadPendingRef.current,
    isRefreshPending: () => refreshPendingRef.current,
    settleFetch,
  };
}
