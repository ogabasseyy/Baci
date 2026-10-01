import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMerchantSenderInfo } from '@/lib/shipping/merchant-sender-location';
import type { ShippingAddress } from '@/lib/shipping/types';

const PUBLIC_SHIPPING_SENDER_RPC = 'get_storefront_shipping_sender';

type PublicMerchantSender = {
  business_address?: unknown;
  business_name?: unknown;
  country?: unknown;
  phone?: unknown;
  state_code?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export type PublicMerchantSenderResult =
  | {
      ok: true;
      sender: ShippingAddress | null;
      /** Canonical merchant country projected by the anonymous-safe RPC. */
      country?: string | null;
    }
  | { error: unknown; ok: false };

/**
 * Loads the anonymous-safe origin projection used by body-only storefront quotes.
 * The RPC returns no sender for unpublished or missing merchants, so callers
 * can fail closed instead of fabricating a Lagos origin.
 */
export async function resolvePublicMerchantSender(
  supabase: SupabaseClient,
  merchantId: string
): Promise<PublicMerchantSenderResult> {
  const { data, error } = await supabase.rpc(PUBLIC_SHIPPING_SENDER_RPC, {
    p_merchant_id: merchantId,
  });

  if (error) return { error, ok: false };
  if (!isRecord(data)) return { ok: true, sender: null };

  const projection = data as PublicMerchantSender;
  const sender = buildMerchantSenderInfo({
    businessAddress: readNullableString(projection.business_address),
    businessName: readNullableString(projection.business_name),
    phone: readNullableString(projection.phone),
    registeredAddress: null,
    stateCode: readNullableString(projection.state_code),
  });

  return {
    ok: true,
    sender,
    country: readNullableString(projection.country),
  };
}
