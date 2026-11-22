import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type PaidOrderDocumentVersion,
  paidOrderAmendmentStatusSchema,
  paidOrderDocumentProjectionSchema,
  paidOrderTrackingProjectionSchema,
} from '@/schemas/order-amendment-document';

export async function loadPaidOrderDocument(
  client: Pick<SupabaseClient, 'rpc'>,
  orderId: string,
  version: PaidOrderDocumentVersion | 'live'
) {
  const { data, error } = await client.rpc(
    'read_paid_order_amendment_document',
    {
      p_order_id: orderId,
      p_version: version,
    }
  );
  if (error)
    return {
      data: null,
      error:
        error.code === 'P0002'
          ? ('not_found' as const)
          : ('unavailable' as const),
    };
  if (data === null) return { data: null, error: null };
  const parsed = paidOrderDocumentProjectionSchema.safeParse(data);
  return parsed.success
    ? { data: parsed.data, error: null }
    : { data: null, error: 'invalid' as const };
}

export async function loadTrackingAmendment(
  client: Pick<SupabaseClient, 'rpc'>,
  orderId: string,
  merchantSlug: string,
  token: string | null,
  email: string | null
) {
  const { data, error } = await client.rpc(
    'read_paid_order_amendment_tracking',
    {
      p_order_id: orderId,
      p_merchant_slug: merchantSlug,
      p_tracking_token: token,
      p_email: email,
    }
  );
  if (error) return null;
  const state = paidOrderAmendmentStatusSchema.safeParse(data);
  if (!state.success) return null;
  const projection = paidOrderTrackingProjectionSchema.safeParse(data);
  return projection.success
    ? { amendment: state.data, projection: projection.data }
    : null;
}
