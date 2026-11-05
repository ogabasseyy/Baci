import { type NextRequest, NextResponse } from 'next/server';
import { loadPublicMerchantRates } from '@/app/api/shipping/quotes/load-public-merchant-rates';
import { toPublicQuoteResponse } from '@/app/api/shipping/quotes/public-quote-response';
import { resolveQuoteMerchantContext } from '@/app/api/shipping/quotes/quote-merchant-context';
import { buildMerchantOnlyQuoteResponse } from '@/app/api/shipping/quotes/quote-source-orchestration';
import { checkCsrfProtection } from '@/lib/csrf';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { createClient } from '@/lib/supabase/server';
import { hasTrustedStorefrontHeaders } from '@/lib/trusted-storefront-headers';
import { chatDeliveryEstimateRequestSchema } from '@/schemas/chat-delivery-estimate';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403, headers: noStoreHeaders }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = chatDeliveryEstimateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid estimate request' },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const subdivisions = getSubdivisions('NG');
  const subdivision = subdivisions.find(
    (entry) =>
      entry.name.toLowerCase() === parsed.data.state.toLowerCase() ||
      entry.aliases?.some(
        (alias) => alias.toLowerCase() === parsed.data.state.toLowerCase()
      )
  );
  if (!subdivision) {
    return NextResponse.json(
      { error: 'A Nigerian state is required' },
      { status: 400, headers: noStoreHeaders }
    );
  }

  if (!hasTrustedStorefrontHeaders(request)) {
    return NextResponse.json(
      { error: 'Store delivery rates are unavailable' },
      { status: 404, headers: noStoreHeaders }
    );
  }

  const supabase = await createClient();
  const merchant = await resolveQuoteMerchantContext({
    data: { shipmentType: 'domestic' },
    request,
    supabase,
  });
  if (
    !merchant.ok ||
    !merchant.merchantId ||
    merchant.merchantCountry == null
  ) {
    const status = merchant.ok ? 404 : merchant.status;
    const message =
      status === 403
        ? 'Store delivery rates are forbidden'
        : status >= 500
          ? 'Store delivery rates could not be loaded'
          : 'Store delivery rates are unavailable';
    return NextResponse.json(
      { error: message },
      { status, headers: noStoreHeaders }
    );
  }

  const currency = resolveMerchantCurrencyConfig({
    country: merchant.merchantCountry,
    payout_currency: merchant.merchantPayoutCurrency,
  }).code;
  if (
    merchant.merchantCountry.trim().toUpperCase() !== 'NG' ||
    currency.trim().toUpperCase() !== 'NGN'
  ) {
    return NextResponse.json(
      {
        error: 'Chat delivery estimates are available only for Nigerian stores',
      },
      { status: 400, headers: noStoreHeaders }
    );
  }
  const rates = await loadPublicMerchantRates(merchant.merchantId, {
    receiverCountryCode: 'NG',
    receiverState: subdivision.name,
    merchantCurrency: currency,
  });
  if (rates.loadFailed) {
    return NextResponse.json(
      { error: 'Store delivery rates could not be loaded' },
      { status: 503, headers: noStoreHeaders }
    );
  }

  const quoteResponse = buildMerchantOnlyQuoteResponse(rates.quotes, undefined);
  return NextResponse.json(toPublicQuoteResponse(quoteResponse), {
    headers: noStoreHeaders,
  });
}
