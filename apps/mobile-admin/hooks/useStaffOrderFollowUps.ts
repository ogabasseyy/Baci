import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FOLLOW_UP_QUERY_LIMIT } from '@/config/follow-up-queue';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { supabase } from '@/lib/supabase';
import { oxygenFollowUpOrderSchema } from '@/schemas/oxygen-follow-up';
import {
  type StaffFollowUp,
  type StaffFollowUpUpdate,
  staffFollowUpSchema,
} from '@/schemas/staff-follow-up';

const SELECT_FIELDS =
  'order_id,merchant_id,assignee_id,assignee_name,stage,outcome,follow_up_on,revision,updated_at';

const OPEN_LOAD_ERROR = 'Could not load open follow-ups.';
const STAFF_LOAD_ERROR = 'Could not load staff follow-ups.';
const UNREADABLE_REPLY_ERROR =
  'Saved, but the latest details could not be shown. Pull down to refresh.';

/**
 * A row that breaks the follow-up contract fails the whole load with a plain
 * message (the queue shows its retry banner) instead of a raw validation
 * error. Skipping the row would silently hide a follow-up from the team.
 */
function readOrThrow<T>(read: () => T, message: string): T {
  try {
    return read();
  } catch (failure) {
    throw new Error(message, { cause: failure });
  }
}

type StaffFollowUpQueue = {
  records: Record<string, StaffFollowUp>;
  openOrders: FailedOrder[];
  isLimited: boolean;
};

async function fetchFollowUps(
  merchantId: string,
  orderIds: string[]
): Promise<StaffFollowUpQueue> {
  const records: Record<string, StaffFollowUp> = {};
  const openOrders: FailedOrder[] = [];
  // Every open follow-up of the store, claimed or orphaned (assignee account
  // deleted, so assignee_id is null and any staff member can reclaim it). It
  // also covers older orders hidden by the email consolidation in
  // useFailedOrders: only the newest order per email is in `orderIds`, so an
  // open claim on an older order surfaces here as its own queue entry instead
  // of being lost.
  const { data: openRows, error: openError } = await supabase
    .from('order_follow_ups')
    .select(
      `${SELECT_FIELDS},order:orders!order_follow_ups_order_id_fkey!inner(id,order_number,customer_id,customer_name,customer_email,customer_phone,total,currency,payment_status,payment_method,created_at,cancelled_at)`
    )
    .eq('merchant_id', merchantId)
    .eq('order.merchant_id', merchantId)
    .neq('stage', 'closed')
    .order('follow_up_on', { ascending: true, nullsFirst: false })
    .order('order_id')
    .limit(FOLLOW_UP_QUERY_LIMIT + 1);

  if (openError) throw new Error(OPEN_LOAD_ERROR);
  for (const row of (openRows ?? []).slice(0, FOLLOW_UP_QUERY_LIMIT)) {
    const followUp = readOrThrow(
      () => staffFollowUpSchema.parse(row),
      OPEN_LOAD_ERROR
    );
    const order = readOrThrow(
      () => oxygenFollowUpOrderSchema.parse(row.order),
      OPEN_LOAD_ERROR
    );
    records[followUp.order_id] = followUp;
    const total = order.total === null ? null : Number(order.total);
    openOrders.push({
      ...order,
      order_number: order.order_number ?? '',
      customer_name: order.customer_name ?? '',
      customer_email: order.customer_email ?? '',
      customer_phone: order.customer_phone ?? '',
      payment_method: order.payment_method ?? '',
      total: Number.isFinite(total) ? total : null,
      payment_status: 'unknown',
      attempt_count: 1,
      follow_up_at: followUp.updated_at,
      staff_follow_up_only: true,
    });
  }

  const remainingIds = orderIds.filter((id) => !records[id]);
  for (let i = 0; i < remainingIds.length; i += 50) {
    const { data, error } = await supabase
      .from('order_follow_ups')
      .select(SELECT_FIELDS)
      .eq('merchant_id', merchantId)
      .in('order_id', remainingIds.slice(i, i + 50));

    if (error) throw new Error(STAFF_LOAD_ERROR);
    const rows = readOrThrow(
      () => staffFollowUpSchema.array().parse(data),
      STAFF_LOAD_ERROR
    );
    for (const row of rows) records[row.order_id] = row;
  }
  return {
    records,
    openOrders,
    isLimited: (openRows?.length ?? 0) > FOLLOW_UP_QUERY_LIMIT,
  };
}

type FollowUpChange =
  | { type: 'claim'; orderId: string }
  | { type: 'update'; fields: StaffFollowUpUpdate };

export function useStaffOrderFollowUps(
  merchantId: string | undefined,
  viewerId: string | undefined,
  orderIds: string[]
) {
  const queryClient = useQueryClient();
  const scope = ['staff-order-follow-ups', merchantId, viewerId];
  const queryKey = [...scope, orderIds];
  const query = useQuery({
    queryKey,
    enabled: Boolean(merchantId && viewerId),
    queryFn: () => {
      if (!merchantId || !viewerId) throw new Error('Store unavailable.');
      return fetchFollowUps(merchantId, orderIds);
    },
  });

  const mutation = useMutation({
    mutationFn: async (change: FollowUpChange) => {
      if (!merchantId || !viewerId) throw new Error('Store unavailable.');
      const { data, error } =
        change.type === 'claim'
          ? await supabase.rpc('claim_order_follow_up', {
              p_merchant_id: merchantId,
              p_order_id: change.orderId,
            })
          : await supabase.rpc('update_order_follow_up', {
              p_merchant_id: merchantId,
              p_order_id: change.fields.order_id,
              p_revision: change.fields.revision,
              p_stage: change.fields.stage,
              p_outcome: change.fields.outcome,
              p_follow_up_on: change.fields.follow_up_on,
            });
      if (error?.code === '23505') {
        throw new Error('Someone else has already claimed this follow-up.');
      }
      // The update function signals a stale revision with PT409 (HTTP 409).
      if (error?.code === 'PT409') {
        throw new Error(
          'This follow-up changed. Check the latest details before saving.'
        );
      }
      if (error) throw new Error('Could not save the follow-up. Try again.');
      // The change is already saved here; the refetch below shows the truth.
      return readOrThrow(
        () => staffFollowUpSchema.parse(data),
        UNREADABLE_REPLY_ERROR
      );
    },
    onSuccess: (row) => {
      queryClient.setQueryData<StaffFollowUpQueue>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          records: { ...current.records, [row.order_id]: row },
          openOrders:
            row.stage === 'closed'
              ? current.openOrders.filter((order) => order.id !== row.order_id)
              : current.openOrders,
        };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: scope }),
  });

  return {
    ...query,
    data: query.data?.records,
    openOrders: query.data?.openOrders,
    isLimited: query.data?.isLimited ?? false,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error?.message,
    resetSave: mutation.reset,
  };
}
