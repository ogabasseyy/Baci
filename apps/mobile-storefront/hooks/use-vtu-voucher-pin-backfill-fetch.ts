import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { fetchWithTimeout, SHORT_TIMEOUT } from '@/lib/fetch-with-timeout';
import { forgetPendingVtuByReference } from '@/lib/pending-vtu-idempotency';
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
  capturedUserId,
  isViewActive,
  reference,
}: {
  apiType: BackfillApiType | null;
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
  // Terminality forgets the retained entry: the success is SHOWN, so
  // a repeat must mint fresh (keeping the key would present the old
  // vend as new). Failure forgets only on confirmed refund. Two
  // guards: polling account (a switch mid-flight must not mutate the
  // registry for a result never shown) and still-mounted (an
  // in-flight fetch resolves after unmount — web's backfill checks
  // cancelled/aborted before its forget; same rule here).
  const failedTerminal = status === 'failed' && refundPending === false;
  const currentUserId = useAuthStore.getState().user?.id ?? null;
  if (
    reference &&
    (status === 'successful' || failedTerminal) &&
    capturedUserId !== null &&
    capturedUserId === currentUserId &&
    isViewActive()
  ) {
    forgetPendingVtuByReference(reference);
  }
  return { pin: pin || null, status, refundPending };
}
