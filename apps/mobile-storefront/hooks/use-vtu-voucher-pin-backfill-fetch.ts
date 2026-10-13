import { withDeadline } from '@baci/shared';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { fetchWithTimeout, SHORT_TIMEOUT } from '@/lib/fetch-with-timeout';
import {
  forgetPendingVtuByReference,
  markSettledPendingVtuByReference,
} from '@/lib/pending-vtu-idempotency';
import { supabase } from '@/lib/supabase';
import { VtuHistoryResponseSchema } from '@/schemas/vtu-history';
import { useAuthStore } from '@/stores/auth-store';

export type BackfillApiType =
  | 'electricity'
  | 'cable_tv'
  | 'betting'
  | 'airtime'
  | 'data';

export interface BackfillObservation {
  pin: string | null;
  status: string | null;
  refundPending: boolean | null;
}

/**
 * QueryFn body for the voucher-pin backfill query.
 *
 * Extracted from `use-vtu-voucher-pin-backfill.ts` per the 300-line
 * Boy Scout Rule (Codex R57 6rseWz). Module scope keeps the hook
 * React Compiler-memoizable; behavior is unchanged and still
 * covered by the hook's renderHook suites.
 */
export async function fetchVoucherPin({
  apiType,
  backgroundSettle = false,
  capturedUserId,
  isViewActive,
  reference,
}: {
  apiType: BackfillApiType | null;
  /**
   * True for the retained-settlement pass (bulk, nothing shown):
   * successes mark stale (suppressed completions skipped) instead of
   * forgetting; refunded failures still forget (R68 6rwG9F).
   */
  backgroundSettle?: boolean;
  /** userId baked into the query key when this fetch started. */
  capturedUserId: string | null;
  /** False once the success view unmounts — see the forget guard. */
  isViewActive: () => boolean;
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
  // Reference scope: the target row is returned even when 20+ newer
  // rows of the type would otherwise push it out (Codex R33 gtRR).
  if (reference) {
    params.set('reference', reference);
  }

  // A blank observation consumes the attempt but keeps polling: only
  // permanent failures (non-429 4xx, broken contract) throw into the
  // error state and halt the loop.
  const BLANK: BackfillObservation = {
    pin: null,
    status: null,
    refundPending: null,
  };
  // One deadline for headers + body (Codex R70 6ryArL).
  const deadlineMs = Date.now() + SHORT_TIMEOUT;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${EXPO_PUBLIC_API_URL}/api/vtu/history?${params.toString()}`,
      {
        method: 'GET',
        deadlineMs,
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
    // Body shares the attempt deadline (R70 6ryArL).
    body = await withDeadline(response.json(), deadlineMs);
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
  // Terminality settles the retained entry. Shown-context (the
  // backfill query displaying this result): forget, so a repeat mints
  // fresh. Background pass: successes mark stale instead (suppressed
  // completions are skipped so their replay presents — R68 6rwG9F).
  // Failure forgets only on confirmed refund (nothing delivered).
  // Guards: polling account (a switch mid-flight must not mutate the
  // registry for a result never shown) and still-mounted.
  const failedTerminal = status === 'failed' && refundPending === false;
  const currentUserId = useAuthStore.getState().user?.id ?? null;
  if (
    reference &&
    (status === 'successful' || failedTerminal) &&
    capturedUserId !== null &&
    capturedUserId === currentUserId &&
    isViewActive()
  ) {
    if (backgroundSettle && status === 'successful') {
      markSettledPendingVtuByReference(reference);
    } else {
      forgetPendingVtuByReference(reference);
    }
  }
  return { pin: pin || null, status, refundPending };
}
