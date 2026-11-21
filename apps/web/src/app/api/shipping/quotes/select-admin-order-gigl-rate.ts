import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { toKobo } from '@/lib/shipping/to-kobo';
import type { ShippingQuote } from '@/lib/shipping/types';
import { settledDeliverySchema } from '@/schemas/settled-partner-delivery';
import { selectEligibleAdminGiglQuote } from './admin-order-gigl-quote.helpers';

export async function selectAdminOrderGiglRate(
  supabase: SupabaseClient,
  order: { id: string; merchant_id: string; source?: string | null },
  quotes: ShippingQuote[]
) {
  const { data, error } = await supabase.rpc(
    'read_settled_partner_delivery' as never,
    { p_order_id: order.id, p_merchant_id: order.merchant_id } as never
  );
  // A known ordinary order can still get a quote during an outage. Without
  // a source we cannot classify the order until the accepted-order lookup works.
  if (error && (!order.source || order.source === 'partner')) {
    return {
      error: NextResponse.json(
        { error: 'Unable to load settled delivery' },
        { status: 503 }
      ),
    };
  }
  // A settlement is read through the accepted-order mapping for this exact
  // order. It governs the rate even if the display source is missing.
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
