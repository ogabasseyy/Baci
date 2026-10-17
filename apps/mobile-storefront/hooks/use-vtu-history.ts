import { fetchJsonWithDeadline } from '@baci/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { SHORT_TIMEOUT } from '@/lib/fetch-with-timeout';
import { markSettledPendingVtuByReference } from '@/lib/pending-vtu-idempotency';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

const HISTORY_FILTER_TO_API_TYPE = {
  airtime: 'airtime',
  data: 'data',
  tv: 'cable_tv',
  power: 'electricity',
  gaming: 'betting',
} as const;

export const VTU_HISTORY_TRANSACTION_TYPES = [
  'airtime',
  'data',
  'electricity',
  'cable_tv',
  'betting',
] as const;

export const VTU_HISTORY_TRANSACTION_STATUSES = [
  'pending',
  'processing',
  'successful',
  'failed',
] as const;

export const VTU_HISTORY_PAYMENT_GATEWAYS = ['paystack', 'korapay'] as const;

export const VTU_HISTORY_PAYMENT_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;

const VTUHistoryTransactionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  type: z.enum(VTU_HISTORY_TRANSACTION_TYPES),
  status: z.enum(VTU_HISTORY_TRANSACTION_STATUSES),
  amount: z.number(),
  network_provider: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  biller_name: z.string().nullable().optional(),
  biller_item_code: z.string().nullable().optional(),
  customer_identifier: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  request_reference: z.string(),
  error_message: z.string().nullable().optional(),
  customer_cashback: z.number().nullable().optional(),
  payment_gateway: z.enum(VTU_HISTORY_PAYMENT_GATEWAYS).nullable().optional(),
  payment_reference: z.string().nullable().optional(),
  payment_status: z.enum(VTU_HISTORY_PAYMENT_STATUSES).nullable().optional(),
  repeat_data_plan_code: z.string().nullable().optional(),
  voucher_pin: z.string().nullable().optional(),
  units: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

const VTUHistoryResponseSchema = z.object({
  transactions: z.array(VTUHistoryTransactionSchema),
});

export type UtilityHistoryFilter =
  | 'all'
  | keyof typeof HISTORY_FILTER_TO_API_TYPE;

export type VTUHistoryTransaction = z.infer<typeof VTUHistoryTransactionSchema>;

export const vtuHistoryKeys = {
  all: ['vtu', 'history'] as const,
  byFilter: (
    userId: string | null,
    filter: UtilityHistoryFilter,
    limit: number
  ) => [...vtuHistoryKeys.all, userId, filter, limit] as const,
};

function getApiTypeForFilter(filter: UtilityHistoryFilter) {
  return filter === 'all' ? null : HISTORY_FILTER_TO_API_TYPE[filter];
}

export function useVTUHistory(filter: UtilityHistoryFilter, limit = 20) {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: vtuHistoryKeys.byFilter(userId, filter, limit),
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      // Query-key owner (Codex R98 P1): every identity observed
      // below must equal the owner the key was created for. A
      // switch between keying and fetching would otherwise return
      // and cache the replacement account's rows — recipient and
      // voucher data — under the previous account's key, and
      // switching back within staleTime would display cross-account
      // history.
      const queryOwnerId = userId;
      if (!queryOwnerId) {
        throw new Error('Authentication required. Please sign in again.');
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('Authentication required. Please sign in again.');
      }
      if (user.id !== queryOwnerId) {
        throw new Error(
          'Account changed during history load. Please try again.'
        );
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      // Bind the token to the key owner (same session.user pattern
      // as getAccessToken's submitter binding): the session object
      // is atomic with its token, while getUser above can already
      // be stale after a mid-flight switch.
      if (session && session.user?.id !== queryOwnerId) {
        throw new Error(
          'Account changed during history load. Please try again.'
        );
      }

      const query = new URLSearchParams({
        merchantSlug: CONFIG.MERCHANT_SLUG,
        limit: String(limit),
      });
      const apiType = getApiTypeForFilter(filter);
      if (apiType) {
        query.set('type', apiType);
      }

      // One deadline for headers + body; stalls abort the fetch
      // pre-retry (R70 6ryArL, R72 6rzq3y). Reads always: failures
      // surface data.error below.
      const deadlineMs = Date.now() + SHORT_TIMEOUT;
      const { data, response } = await fetchJsonWithDeadline<{
        error?: string;
      }>(`${EXPO_PUBLIC_API_URL}/api/vtu/history?${query.toString()}`, {
        method: 'GET',
        deadlineMs,
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token && {
            Authorization: `Bearer ${session.access_token}`,
          }),
        },
      });

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load utility history.');
      }

      const parsed = VTUHistoryResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error('Invalid utility history response from server.');
      }

      // Background terminal update (R57 6rseWu, R69 6rxZFO): the
      // voucher backfill stops polling after ~36 minutes, but
      // reconciliation pages are unbounded — a row settling later
      // would leave its retained entry replaying the old vend as new.
      // History is also mounted hidden (quick-repeat defaults,
      // receipts pager), so a read never proves display: successes
      // mark stale (suppressed completions skipped) instead of
      // forgetting. Same account guard as the backfill. Successes
      // only — this projection carries no refund proof, so failed
      // rows keep backfill-era behavior.
      // Discard after a post-fetch switch (Codex R98 P1): the rows
      // above belong to whoever the token named, so a live identity
      // that no longer equals the key owner must not be returned
      // (cached under the owner's key) or settled.
      const currentUserId = useAuthStore.getState().user?.id ?? null;
      if (currentUserId !== queryOwnerId) {
        throw new Error(
          'Account changed during history load. Please try again.'
        );
      }
      for (const transaction of parsed.data.transactions) {
        if (transaction.status === 'successful') {
          markSettledPendingVtuByReference(transaction.request_reference);
        }
      }

      return parsed.data.transactions;
    },
  });
}
