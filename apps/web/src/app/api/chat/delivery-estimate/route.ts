import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadPublicMerchantRates } from '@/app/api/shipping/quotes/load-public-merchant-rates';
import { toPublicQuoteResponse } from '@/app/api/shipping/quotes/public-quote-response';
import { resolveQuoteMerchantContext } from '@/app/api/shipping/quotes/quote-merchant-context';
import { buildMerchantOnlyQuoteResponse } from '@/app/api/shipping/quotes/quote-source-orchestration';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { createClient } from '@/lib/supabase/server';

const RequestSchema = z
  .object({ state: z.string().trim().min(2).max(100) })
  .strict();
const noStoreHeaders = { 'Cache-Control': 'no-store' };

function hasTrustedStorefrontHeaders(request: NextRequest): boolean {
  const host =
    (request.headers.get('host') ?? '').split(':')[0]?.trim().toLowerCase() ??
    '';
  const slug = request.headers.get('x-merchant-slug')?.trim().toLowerCase();
  const domain = request.headers.get('x-merchant-domain')?.trim().toLowerCase();
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
  ).toLowerCase();
  if (domain && (host === domain || host === `www.${domain}`)) return true;
  if (!slug) return false;
  return (
    host === `${slug}.${rootDomain}` ||
    host === `${slug}.localhost` ||
    host.startsWith(`${slug}.localhost:`)
  );
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
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
    return NextResponse.json(
      { error: 'Store delivery rates are unavailable' },
      { status: 404, headers: noStoreHeaders }
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
