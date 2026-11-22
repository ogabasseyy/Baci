import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import type { OrderCreateInput } from '@/schemas/orders';
import { rejectUnavailableMobileOxygenOrder } from './mobile-oxygen-order-admission';

export async function resolveOrderCreationMerchant({
  request,
  supabase,
  order,
  userId,
  allowReadOnlyOxygenReplay = false,
}: {
  request: Request;
  supabase: SupabaseClient;
  order: Pick<OrderCreateInput, 'merchant_id' | 'payment_method' | 'source'>;
  userId: string | null;
  allowReadOnlyOxygenReplay?: boolean;
}) {
  // Fetch merchant to verify it exists (include business_name, slug for email)
  const { data: merchant, error: merchantFetchError } = await supabase
    .from('merchants')
    .select(
      'id, phone, rider_phone_number, business_name, business_address, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number, plan_tier, vat_registration_status, vat_rate, registered_address, support_phone, logo_url, legal_entity_name, brand_colors, bank_code, bank_account_number, bank_name, bank_account_name, social_media, pages, payout_currency, country'
    )
    .eq('id', order.merchant_id)
    .single();

  if (merchantFetchError || !merchant) {
    logger.error({
      message: 'Failed to fetch merchant for order creation',
      error: merchantFetchError,
    });
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
    };
  }

  const oxygenAdmission = await rejectUnavailableMobileOxygenOrder({
    request,
    client: supabase,
    merchant,
    userId,
    paymentMethod: order.payment_method,
    source: order.source,
  });
  if (oxygenAdmission) {
    if (allowReadOnlyOxygenReplay && userId)
      return { ok: true as const, merchant, oxygenAdmission };
    return { ok: false as const, response: oxygenAdmission };
  }

  return { ok: true as const, merchant };
}
