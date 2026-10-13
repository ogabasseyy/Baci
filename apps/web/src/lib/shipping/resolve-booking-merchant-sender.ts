import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMerchantSenderInfo } from '@/lib/shipping/merchant-sender-location';
import type { ShippingAddress } from '@/lib/shipping/types';

type MerchantSenderRow = {
  business_address: string | null;
  business_name: string | null;
  phone: string | null;
  registered_address: unknown;
  state_code: string | null;
};

export type ResolveBookingMerchantSenderResult =
  | { ok: true; sender: ShippingAddress }
  | { error: string; ok: false; status: number };

function isMissingMerchantRow(error: unknown, data: unknown): boolean {
  if (data || !error || typeof error !== 'object') return !data && !error;

  const errorRecord = error as { code?: unknown; message?: unknown };
  return (
    errorRecord.code === 'PGRST116' ||
    (typeof errorRecord.message === 'string' &&
      errorRecord.message.toLowerCase().includes('not found'))
  );
}

/**
 * Loads the registered merchant origin for domestic booking. Callers must not
 * trust request-controlled sender payloads for domestic quotes.
 */
export async function resolveBookingMerchantSender(
  supabase: SupabaseClient,
  merchantId: string,
  fallbackBusinessName?: string | null
): Promise<ResolveBookingMerchantSenderResult> {
  const { data, error } = await supabase
    .from('merchants')
    .select(
      'business_name, business_address, phone, registered_address, state_code'
    )
    .eq('id', merchantId)
    .single();

  if (error || !data) {
    console.error('Error fetching merchant for booking sender:', error);
    return {
      error: isMissingMerchantRow(error, data)
        ? 'Merchant details not found'
        : 'Failed to resolve merchant sender',
      ok: false,
      status: isMissingMerchantRow(error, data) ? 404 : 500,
    };
  }

  const merchant = data as MerchantSenderRow;
  const sender = buildMerchantSenderInfo({
    businessAddress: merchant.business_address,
    businessName: merchant.business_name ?? fallbackBusinessName ?? null,
    phone: merchant.phone,
    registeredAddress: merchant.registered_address,
    stateCode: merchant.state_code,
  });
  if (!sender) {
    return {
      error: 'Merchant shipping origin is not configured',
      ok: false,
      status: 400,
    };
  }

  return { ok: true, sender };
}
