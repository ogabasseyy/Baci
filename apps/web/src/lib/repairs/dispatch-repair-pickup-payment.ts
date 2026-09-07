import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { handleRepairPickupPayment } from './handle-repair-pickup-payment';

interface DispatchRepairPickupPaymentOptions {
  gateway: 'paystack' | 'korapay';
  gatewayResponse: Record<string, unknown>;
  reference: string;
  supabase: SupabaseClient;
  verifiedAmount: number;
}

export async function dispatchRepairPickupPayment(
  options: DispatchRepairPickupPaymentOptions
): Promise<NextResponse | null> {
  const result = await handleRepairPickupPayment(options);
  return result.handled
    ? NextResponse.json(result.body, { status: result.status })
    : null;
}
