import { cookies } from 'next/headers';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { repairBookingSchema } from '@/lib/validations/repair';
import { repairMerchantIdSchema } from '@/schemas/repair-actions';

/**
 * Stable, machine-readable failure classification. The web server action
 * ignores this (it only inspects `success`/`error`/`fieldErrors`), but the
 * mobile storefront booking route (`POST /api/storefront/[slug]/repairs/book`)
 * maps it directly to an HTTP status code so callers never need to
 * pattern-match the human-readable `error` copy.
 */
export type RepairBookingErrorCode =
  | 'rate_limited'
  | 'invalid_merchant'
  | 'validation_failed'
  | 'not_found'
  | 'unavailable'
  | 'unknown';

export type CreateRepairResult =
  | { success: true; id: string; ticketNumber: number }
  | {
      success: false;
      error: string;
      code: RepairBookingErrorCode;
      fieldErrors?: Record<string, string[]>;
    };

const RATE_LIMIT_MESSAGE =
  'Too many repair requests. Please try again in a minute.';
const GENERIC_FAILURE = 'Failed to submit repair request. Please try again.';

/**
 * Maps the booking RPC's raised exception messages to storefront-safe copy
 * plus a stable error code.
 */
function mapRpcError(message: string | undefined): {
  error: string;
  code: RepairBookingErrorCode;
} {
  if (!message) {
    return { error: GENERIC_FAILURE, code: 'unknown' };
  }
  if (message.includes('rate_limited')) {
    return { error: RATE_LIMIT_MESSAGE, code: 'rate_limited' };
  }
  if (
    message.includes('merchant_not_found') ||
    message.includes('merchant_required')
  ) {
    return { error: 'Store not found.', code: 'not_found' };
  }
  if (message.includes('invalid_')) {
    return { error: 'Validation failed', code: 'validation_failed' };
  }
  if (
    message.includes('quote_unavailable') ||
    message.includes('device_unavailable') ||
    message.includes('catalog_disabled')
  ) {
    return {
      error: 'That repair option is no longer available. Please pick another.',
      code: 'unavailable',
    };
  }
  return { error: GENERIC_FAILURE, code: 'unknown' };
}

/**
 * Shared repair booking core used by the web server action
 * (`app/actions/repair.ts`) and the mobile storefront booking route
 * (`app/api/storefront/[slug]/repairs/book/route.ts`). Applies the app-layer
 * rate limit FIRST, validates input, then delegates the write to the
 * SECURITY DEFINER booking RPC which re-validates the merchant/active quote
 * and snapshots the price server-side.
 *
 * `data` is intentionally `unknown` — the caller may be a typed React Hook
 * Form submission (web) or a raw JSON body parsed from an HTTP request
 * (mobile route); the Zod parse below is the single source of truth for
 * validating either shape.
 */
export async function createRepairBooking(
  data: unknown,
  merchantId: string
): Promise<CreateRepairResult> {
  const allowed = await ensureActionRateLimit('repair-create', {
    requests: 5,
    windowMs: 60_000,
  });
  if (!allowed) {
    return { success: false, error: RATE_LIMIT_MESSAGE, code: 'rate_limited' };
  }

  const parsedMerchantId = repairMerchantIdSchema.safeParse(merchantId);
  if (!parsedMerchantId.success) {
    return {
      success: false,
      error: 'Invalid store reference.',
      code: 'invalid_merchant',
    };
  }

  const parsed = repairBookingSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Validation failed',
      code: 'validation_failed',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const input = parsed.data;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Pickup inserts persist pickup_payment_status='awaiting_payment' inside the
  // booking RPC (atomic with the row). The post-create mark RPC only reinforces.
  const { data: rpcData, error } = await supabase.rpc('create_repair_booking', {
    p_merchant_id: parsedMerchantId.data,
    p_customer_name: input.customerName,
    p_customer_email: input.customerEmail,
    p_customer_phone: input.customerPhone,
    p_device_type: input.deviceType,
    p_device_model: input.deviceModel,
    p_issue_description: input.issueDescription,
    p_preferred_date: input.preferredDate
      ? new Date(input.preferredDate).toISOString()
      : null,
    p_service_type: input.serviceType,
    p_pickup_address: input.pickupAddress || null,
    p_device_id: input.deviceId ?? null,
    p_quote_id: input.quoteId ?? null,
  });

  if (error) {
    console.error('Error creating repair booking:', error);
    const mapped = mapRpcError(error.message);
    return { success: false, error: mapped.error, code: mapped.code };
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  const record =
    row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
  const id = record?.id;
  const ticketNumber = record?.ticket_number;

  if (typeof id !== 'string' || typeof ticketNumber !== 'number') {
    return { success: false, error: GENERIC_FAILURE, code: 'unknown' };
  }

  return { success: true, id, ticketNumber };
}
