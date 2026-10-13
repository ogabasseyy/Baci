import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { ValidUtilityType } from '@/components/utilities/utility-purchase.types';
import { useAuthStore } from '@/stores/auth-store';
import type {
  BackfillApiType,
  BackfillObservation,
} from './use-vtu-voucher-pin-backfill-fetch';
import { fetchVoucherPin } from './use-vtu-voucher-pin-backfill-fetch';

// Bill-style purchases (electricity, TV, betting) may receive their voucher /
// token after the initial confirm response returns, once the upstream provider
// reports back. Poll the history endpoint until the pin is persisted so the
// success screen can surface it without forcing the user to re-open history.
// Airtime/data ride the same loop for SETTLEMENT (no voucher expected):
// a terminal observation settles the retained idempotency entry, without
// which an identical later purchase would recall the key and present the
// old vend as new — forever, since the stale guard only fires past an
// OBSERVED completion.
export const POLL_INTERVAL_MS = 3000;
export const POLL_SLOW_INTERVAL_MS = 10_000;
export const POLL_PATIENT_INTERVAL_MS = 60_000;
export const FAST_POLL_ATTEMPTS = 10;
export const SLOW_POLL_ATTEMPTS = 43;
export const MAX_POLL_ATTEMPTS = 73;

const UTILITY_TYPE_TO_API_TYPE: Partial<
  Record<ValidUtilityType, BackfillApiType>
> = {
  power: 'electricity',
  tv: 'cable_tv',
  gaming: 'betting',
  airtime: 'airtime',
  data: 'data',
};

/** History types whose success may still gain a late token. */
const TOKEN_BACKFILL_API_TYPES: ReadonlySet<BackfillApiType> = new Set([
  'electricity',
  'cable_tv',
  'betting',
]);

export type VtuBackfillTerminalStatus = 'successful' | 'failed';

export interface VtuVoucherPinBackfill {
  pin: string | null;
  /** Last terminal status observed; null while non-terminal. */
  status: VtuBackfillTerminalStatus | null;
  /**
   * Refund proof for the failure copy: true only when history shows
   * failed with refund_pending === false. Downstream copy must gate
   * on this — never on `failed` alone, which future callers could
   * pass without proof.
   */
  refundConfirmed: boolean;
}

function toTerminalStatus(
  observed: BackfillObservation | null | undefined
): VtuBackfillTerminalStatus | null {
  if (!observed) {
    return null;
  }
  if (observed.status === 'successful') {
    return 'successful';
  }
  // Fail-closed (explicit false only): an unconfirmed failure keeps
  // the purchase non-terminal until the refund lands, like web.
  if (observed.status === 'failed' && observed.refundPending === false) {
    return 'failed';
  }
  return null;
}

interface UseVtuVoucherPinBackfillInput {
  enabled: boolean;
  reference: string | null | undefined;
  utilityType: ValidUtilityType;
}

export function useVtuVoucherPinBackfill({
  enabled,
  reference,
  utilityType,
}: UseVtuVoucherPinBackfillInput): VtuVoucherPinBackfill {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const apiType = UTILITY_TYPE_TO_API_TYPE[utilityType] ?? null;
  const queryEnabled = Boolean(enabled && reference && apiType && userId);
  // dataUpdateCount only increments on referential change; null === null keeps
  // it at 1 forever. Track fetch attempts independently so the cap is reliable.
  const fetchCountRef = useRef(0);
  // The budget is per query identity, not per mount: an account/type/
  // reference switch starts a fresh query that deserves a fresh budget.
  // Without the reset, the old query's spent count would starve the new
  // one (e.g. switch away and back leaves one fetch before the cap).
  const lastIdentityRef = useRef<string | null>(null);
  // The success screen owns this hook, so mounted means shown: an
  // unmount before resolution must skip the forget (Codex R31 fQGT).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { data } = useQuery<BackfillObservation | null>({
    queryKey: ['vtu', 'voucher-pin-backfill', userId, apiType, reference],
    enabled: queryEnabled,
    staleTime: 0,
    gcTime: 0,
    retry: 0,
    refetchInterval: (q) => {
      const observed = q.state.data;
      const terminal = toTerminalStatus(observed);
      // A pin always stops the hunt. A successful row keeps polling
      // while a token may still arrive (the server schedules late
      // token backfills for pin-less successes of these types);
      // tokenless successes and confirmed failures settle.
      const tokenHunt =
        terminal === 'successful' &&
        !observed?.pin &&
        apiType !== null &&
        TOKEN_BACKFILL_API_TYPES.has(apiType);
      if (
        observed?.pin ||
        (terminal !== null && !tokenHunt) ||
        q.state.status === 'error'
      ) {
        return false;
      }
      if (fetchCountRef.current >= MAX_POLL_ATTEMPTS) {
        return false;
      }
      // Backoff mirrors web: 3s for the first 10 attempts, 10s to
      // attempt 43 (~6 minutes), then a 60s patient lane to attempt
      // 73 (~36 minutes). The reconciler rotates one 25-row page per
      // 5-minute window, so a backlog row settles after a 6-minute
      // loop gives up — and the retained entry would then replay the
      // old vend as a later identical purchase (Codex R55 6rrU6M).
      if (fetchCountRef.current <= FAST_POLL_ATTEMPTS) {
        return POLL_INTERVAL_MS;
      }
      if (fetchCountRef.current <= SLOW_POLL_ATTEMPTS) {
        return POLL_SLOW_INTERVAL_MS;
      }
      return POLL_PATIENT_INTERVAL_MS;
    },
    queryFn: (context) => {
      // Key layout: ['vtu', 'voucher-pin-backfill', userId, apiType,
      // reference]. A new identity resets the attempt budget; the
      // polling account doubles as the side-effect guard below.
      const identity = JSON.stringify([
        context.queryKey[2],
        context.queryKey[3],
        context.queryKey[4],
      ]);
      if (lastIdentityRef.current !== identity) {
        lastIdentityRef.current = identity;
        fetchCountRef.current = 0;
      }
      fetchCountRef.current += 1;
      const rawUserId = context.queryKey[2];
      const capturedUserId = typeof rawUserId === 'string' ? rawUserId : null;
      return fetchVoucherPin({
        apiType,
        capturedUserId,
        reference,
        isViewActive: () => mountedRef.current,
      });
    },
  });

  return {
    pin: data?.pin ?? null,
    status: toTerminalStatus(data),
    refundConfirmed: data?.status === 'failed' && data?.refundPending === false,
  };
}
