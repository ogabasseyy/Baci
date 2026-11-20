import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toKobo } from '@/lib/shipping/to-kobo';
import type { ShippingQuote } from '@/lib/shipping/types';
import { selectEligibleAdminGiglQuote } from './admin-order-gigl-quote.helpers';

const settledDeliverySchema = z.object({
  service: z.string().min(1),
  delivery_minor: z.number().int().positive(),
});

export async function selectAdminOrderGiglRate(
  supabase: SupabaseClient,
  order: { id: string; merchant_id: string; source?: string | null },
  quotes: ShippingQuote[]
) {
  const { data, error } = await supabase.rpc(
    'read_settled_partner_delivery' as never,
    { p_order_id: order.id, p_merchant_id: order.merchant_id } as never
  );
  // Keep ordinary quotes available during a lookup outage. The bind RPC
  // still enforces the settled service and price for every accepted partner order.
  if (error && order.source === 'partner') {
    return {
      error: NextResponse.json(
        { error: 'Unable to load settled delivery' },
        { status: 503 }
      ),
    };
  }
  if (!error && (data !== null || order.source === 'partner')) {
    if (data === null) {
      return {
        error: NextResponse.json(
          {
            code: 'PARTNER_DELIVERY_NOT_SETTLED',
            error: 'Settled delivery terms are unavailable for this order.',
          },
          { status: 409 }
        ),
      };
    }
    const settled = settledDeliverySchema.safeParse(data);
    if (!settled.success) {
      return {
        error: NextResponse.json(
          { error: 'Unable to load settled delivery' },
          { status: 503 }
        ),
      };
    }
    const candidate = selectEligibleAdminGiglQuote(
      quotes.filter(
        (quote) =>
          quote.serviceTier === settled.data.service &&
          toKobo(quote.price) === settled.data.delivery_minor
      )
    );
    if (!candidate) {
      return {
        error: NextResponse.json(
          {
            code: 'PARTNER_DELIVERY_RATE_UNAVAILABLE',
            error: 'The settled GIG delivery rate and service are unavailable.',
          },
          { status: 409 }
        ),
      };
    }
    return { quote: candidate };
  }
  const quote = selectEligibleAdminGiglQuote(quotes);
  return quote
    ? { quote }
    : {
        error: NextResponse.json(
          { error: 'No eligible GIGL address-delivery quote' },
          { status: 503 }
        ),
      };
}
