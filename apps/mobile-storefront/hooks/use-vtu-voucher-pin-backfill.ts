import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import type { ValidUtilityType } from '@/components/utilities/utility-purchase.types';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { fetchWithTimeout, SHORT_TIMEOUT } from '@/lib/fetch-with-timeout';
import { settlePendingVtuByReference } from '@/lib/pending-vtu-idempotency';
import { supabase } from '@/lib/supabase';
import { VtuHistoryResponseSchema } from '@/schemas/vtu-history';
import { useAuthStore } from '@/stores/auth-store';

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
export const FAST_POLL_ATTEMPTS = 10;
export const MAX_POLL_ATTEMPTS = 43;

type BackfillApiType =
  | 'electricity'
  | 'cable_tv'
  | 'betting'
  | 'airtime'
  | 'data';

const UTILITY_TYPE_TO_API_TYPE: Partial<
  Record<ValidUtilityType, BackfillApiType>
> = {
  power: 'electricity',
  tv: 'cable_tv',
  gaming: 'betting',
  airtime: 'airtime',
  data: 'data',
};

interface BackfillObservation {
  pin: string | null;
  status: string | null;
  refundPending: boolean | null;
}

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

// Module-scope queryFn body: the throw-inside-try control flow lives outside
// component scope so React Compiler can still memoize the hook.
async function fetchVoucherPin({
  apiType,
  reference,
}: {
  apiType: BackfillApiType | null;
  reference: string | null | undefined;
}): Promise<BackfillObservation | null> {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    return null;
  }

  const params = new URLSearchParams({
    merchantSlug: CONFIG.MERCHANT_SLUG,
    limit: '20',
  });
  if (apiType) {
    params.set('type', apiType);
  }

  // A blank observation consumes the attempt but keeps polling: only
  // permanent failures (non-429 4xx, broken contract) throw into the
  // error state and halt the loop.
  const BLANK: BackfillObservation = {
    pin: null,
    status: null,
    refundPending: null,
  };
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${EXPO_PUBLIC_API_URL}/api/vtu/history?${params.toString()}`,
      {
        method: 'GET',
        timeout: SHORT_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      }
    );
  } catch {
    // Network/timeout: transient, retry within budget.
    return BLANK;
  }
  if (!response.ok) {
    // 5xx/429 are transient: consume the attempt and retry. Other 4xx
    // (auth, bad request) won't heal by retrying — throw so React
    // Query sets status='error' and halts refetchInterval.
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`VTU history fetch failed: ${response.status}`);
    }
    return BLANK;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Unparseable body: transient, retry within budget.
    return BLANK;
  }

  const parsed = VtuHistoryResponseSchema.safeParse(body);
  if (!parsed.success) {
    // Broken contract — throw so polling halts instead of burning remaining
    // attempts returning blanks that React Query treats as successful data.
    throw new Error('VTU history response schema mismatch');
  }

  const match = parsed.data.transactions.find(
    (transaction) => transaction.request_reference === reference
  );
  const pin =
    typeof match?.voucher_pin === 'string' ? match.voucher_pin.trim() : '';
  const status = typeof match?.status === 'string' ? match.status : null;
  const refundPending =
    typeof match?.refund_pending === 'boolean' ? match.refund_pending : null;
  // Terminality learned from history settles the retained registry
  // entry (success marks completion; failure forgets, but only once
  // the refund is confirmed — settling on an unconfirmed failure
  // would refresh the wallet against the still-debited balance with
  // no later refresh when the refund lands). The response path never
  // saw it, so without this the stale guard could never fire.
  const failedTerminal = status === 'failed' && refundPending === false;
  if (reference && (status === 'successful' || failedTerminal)) {
    settlePendingVtuByReference(
      reference,
      status === 'successful' ? 'successful' : 'failed'
    );
  }
  return { pin: pin || null, status, refundPending };
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
      // Backoff mirrors web: 3s for the first 10 attempts, then 10s.
      // 43 attempts span ~6 minutes — reconciliation excludes rows
      // younger than 45s and its worker runs every 5 minutes, so a
      // 27s loop could never observe a normally delayed settlement.
      return fetchCountRef.current <= FAST_POLL_ATTEMPTS
        ? POLL_INTERVAL_MS
        : POLL_SLOW_INTERVAL_MS;
    },
    queryFn: () => {
      fetchCountRef.current += 1;
      return fetchVoucherPin({ apiType, reference });
    },
  });

  return {
    pin: data?.pin ?? null,
    status: toTerminalStatus(data),
  };
}
