import {
  isPlausibleMerchantContactPhone,
  normalizePhoneToE164,
} from '@baci/shared/lib';
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
  | {
      code?: 'MERCHANT_SENDER_PHONE_INVALID';
      error: string;
      ok: false;
      status: number;
    };

/**
 * Couriers call the sender on this number, so a blank or truncated store phone
 * (for example "+23415781") must stop booking before any provider request.
 * Domestic origins are Nigerian, so national-format numbers are read as +234.
 */
function isBookableSenderPhone(phone: string): boolean {
  if (!isPlausibleMerchantContactPhone(phone)) return false;
  // normalizePhoneToE164 returns digits only, without a leading "+"
  // (e.g. "2348146978921"), so a Nigerian number must be 234 + 10 digits.
  const e164 = normalizePhoneToE164(phone);
  return e164 !== null && (!e164.startsWith('234') || e164.length === 13);
}

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
  if (!isBookableSenderPhone(sender.phone)) {
    return {
      code: 'MERCHANT_SENDER_PHONE_INVALID',
      error:
        'Your store phone number is missing or incomplete. Update it in Store Settings, then try again.',
      ok: false,
      status: 400,
    };
  }

  return { ok: true, sender };
}
