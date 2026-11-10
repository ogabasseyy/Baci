/**
 * Price Negotiation API
 * Allows customers to submit price offers and receive counter-offers
 */

import {
  COUNTER_NEGOTIATION_DISCOUNT_STEPS,
  isProductNegotiable,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
} from '@baci/shared/lib';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { formatMerchantCurrency } from '@/lib/resolve-merchant-currency';
import { createClient } from '@/lib/supabase/server';
import { storefrontNegotiationSchema } from '@/schemas/storefront-negotiation';

// Counter-offer discount tiers — capped by the shared 2% auto-negotiation policy
const DISCOUNT_TIERS = {
  1: COUNTER_NEGOTIATION_DISCOUNT_STEPS[0], // 1% discount on first attempt
  2: COUNTER_NEGOTIATION_DISCOUNT_STEPS[1], // 1.5% discount on second attempt
  3: COUNTER_NEGOTIATION_DISCOUNT_STEPS[2], // 2% hard floor on third attempt (final offer)
};

interface NegotiationResult {
  status: 'accepted' | 'counter' | 'rejected' | 'final';
  counterOffer?: number;
  originalPrice: number;
  offeredPrice: number;
  message: string;
  attemptNumber: number;
  canContinue: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = storefrontNegotiationSchema.parse(body);

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Fetch product details
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, brand, price, merchant_id')
      .eq('id', validatedData.productId)
      .eq('merchant_id', validatedData.merchantId)
      .eq('status', 'active')
      .single();

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Customer-facing negotiation messages must render in the merchant's own
    // display currency (not a hardcoded ₦) — a lightweight second select
    // instead of an embedded join to avoid Supabase relationship-name
    // ambiguity between products and merchants.
    const { data: merchantCurrency, error: merchantCurrencyError } =
      await supabase
        .from('merchants')
        .select('payout_currency, country')
        .eq('id', product.merchant_id)
        .maybeSingle();

    if (merchantCurrencyError) {
      console.error(
        'Negotiation merchant currency lookup error:',
        merchantCurrencyError
      );
    }

    const formatOfferPrice = (amount: number) =>
      formatMerchantCurrency(amount, merchantCurrency ?? {}, {
        maximumFractionDigits: 0,
      });

    const originalPrice = Number(product.price);
    // The database selects a fixed public-price tier using the private margin.
    // Never expose a continuous cost-derived floor. Validate the fixed tier here
    // as well so a stale migration fails closed instead of leaking exact costs.
    const { data: costFloor, error: costFloorError } = await supabase.rpc(
      'get_negotiation_cost_floor_price',
      { p_product_id: product.id, p_merchant_id: product.merchant_id }
    );
    const costFloorPrice = Number(costFloor);
    const publicPriceTiers = [
      originalPrice,
      ...Object.values(DISCOUNT_TIERS).map((rate) =>
        Math.ceil((originalPrice * Math.round((1 - rate) * 1000)) / 1000)
      ),
    ];
    if (
      costFloorError ||
      costFloor == null ||
      !Number.isFinite(originalPrice) ||
      originalPrice <= 0 ||
      !Number.isFinite(costFloorPrice) ||
      costFloorPrice > originalPrice ||
      !publicPriceTiers.includes(costFloorPrice)
    ) {
      console.error('Negotiation cost floor lookup error:', costFloorError);
      return NextResponse.json(
        { error: 'Failed to process negotiation' },
        { status: 500 }
      );
    }
    const minAcceptablePrice = Math.max(
      costFloorPrice,
      originalPrice * (1 - MAX_AUTO_NEGOTIATION_DISCOUNT_RATE)
    );

    const attemptNumber = validatedData.attemptNumber;
    const offeredPrice = validatedData.offeredPrice;

    const isNegotiable = isProductNegotiable({
      brand: product.brand,
      name: product.name,
    });

    let result: NegotiationResult;

    if (!isNegotiable) {
      // Non-negotiable products (budget brands, Samsung A-series) are already
      // priced at their best — no auto-accept, counter, or margin branches.
      result = {
        status: 'final',
        originalPrice,
        offeredPrice,
        message: 'This is already the best price.',
        attemptNumber,
        canContinue: false,
      };
    } else if (offeredPrice >= originalPrice) {
      // Customer offered full price or more
      result = {
        status: 'accepted',
        originalPrice,
        offeredPrice,
        message: 'Your offer has been accepted!',
        attemptNumber,
        canContinue: false,
      };
    } else if (offeredPrice >= minAcceptablePrice) {
      // Offer is within acceptable range (cost margin + 2% cap)
      result = {
        status: 'accepted',
        originalPrice,
        offeredPrice,
        message: `Great news! We can accept your offer of ${formatOfferPrice(offeredPrice)}.`,
        attemptNumber,
        canContinue: false,
      };
    } else if (minAcceptablePrice >= originalPrice) {
      // No safe discount tier exists. Keep the public list price rather than
      // returning a private cost-derived amount or a quote above list price.
      result = {
        status: 'final',
        counterOffer: originalPrice,
        originalPrice,
        offeredPrice,
        message: 'This is already the best price.',
        attemptNumber,
        canContinue: false,
      };
    } else if (attemptNumber >= 3) {
      // Final attempt - give best possible price
      const finalPrice = Math.max(
        minAcceptablePrice,
        originalPrice * (1 - DISCOUNT_TIERS[3])
      );

      if (offeredPrice >= finalPrice) {
        result = {
          status: 'accepted',
          originalPrice,
          offeredPrice,
          message: 'Your final offer has been accepted!',
          attemptNumber,
          canContinue: false,
        };
      } else {
        result = {
          status: 'final',
          counterOffer: Math.ceil(finalPrice),
          originalPrice,
          offeredPrice,
          message: `This is our best price: ${formatOfferPrice(Math.ceil(finalPrice))}. We cannot go lower.`,
          attemptNumber,
          canContinue: false,
        };
      }
    } else {
      // Generate counter-offer based on attempt
      const discountRate = DISCOUNT_TIERS[attemptNumber as 1 | 2];
      const counterOffer = Math.max(
        minAcceptablePrice,
        originalPrice * (1 - discountRate)
      );

      result = {
        status: 'counter',
        counterOffer: Math.ceil(counterOffer),
        originalPrice,
        offeredPrice,
        message:
          attemptNumber === 1
            ? `We appreciate your offer! How about ${formatOfferPrice(Math.ceil(counterOffer))}?`
            : `We've reduced our price further to ${formatOfferPrice(Math.ceil(counterOffer))}.`,
        attemptNumber,
        canContinue: attemptNumber < 3,
      };
    }

    // Log negotiation for analytics (non-blocking, don't fail if logging fails)
    supabase
      .from('negotiation_logs')
      .insert({
        product_id: validatedData.productId,
        merchant_id: validatedData.merchantId,
        customer_email: validatedData.customerEmail,
        customer_phone: validatedData.customerPhone,
        original_price: originalPrice,
        offered_price: offeredPrice,
        counter_offer: result.counterOffer,
        attempt_number: attemptNumber,
        status: result.status,
        evidence_url: validatedData.evidenceUrl,
        evidence_note: validatedData.evidenceNote,
      })
      .then(({ error }) => {
        if (error) console.error('Negotiation log error:', error);
      });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Negotiation API error:', error);

    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to process negotiation' },
      { status: 500 }
    );
  }
}
