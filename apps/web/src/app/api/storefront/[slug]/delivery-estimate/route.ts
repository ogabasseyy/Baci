import { type NextRequest, NextResponse } from 'next/server';
import { loadPublicMerchantRates } from '@/app/api/shipping/quotes/load-public-merchant-rates';
import { toPublicQuoteResponse } from '@/app/api/shipping/quotes/public-quote-response';
import { buildMerchantOnlyQuoteResponse } from '@/app/api/shipping/quotes/quote-source-orchestration';
import { getRootDomain } from '@/env';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantByIdentifierOrAlias } from '@/lib/get-merchant-by-identifier-or-alias';
import { isPlatformHost, normalizeHostname } from '@/lib/proxy/host';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { getSubdivisions } from '@/lib/shipping/merchant-rates/subdivisions';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { chatDeliveryEstimateRequestSchema } from '@/schemas/chat-delivery-estimate';
import { RouteIdentifierSchema } from '@/schemas/route-identifier';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStoreHeaders });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return errorResponse('CSRF validation failed', 403);

  const { slug: rawSlug } = await context.params;
  const slug = rawSlug.trim().toLowerCase();
  // This route accepts merchant slugs, not domain identifiers.
  if (
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ||
    !RouteIdentifierSchema.safeParse(slug).success
  ) {
    return errorResponse('Invalid storefront slug', 400);
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = chatDeliveryEstimateRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse('Invalid estimate request', 400);

  const subdivision = getSubdivisions('NG').find(
    (entry) =>
      entry.name.toLowerCase() === parsed.data.state.toLowerCase() ||
      entry.aliases?.some(
        (alias) => alias.toLowerCase() === parsed.data.state.toLowerCase()
      )
  );
  if (!subdivision) {
    return errorResponse('A Nigerian state is required', 400);
  }

  // Platform hosts route stores by path; merchant domains must resolve from
  // the trusted host and match the path slug before rates are returned.
  const platformHost = isPlatformHost(
    normalizeHostname(request.headers.get('host') || new URL(request.url).host)
  );
  let hostMerchantId: string | null = null;
  if (!platformHost) {
    const hostMerchant = await resolveStorefrontMerchantFromRequest({
      request,
      rootDomain: getRootDomain() || 'usebaci.com',
      notFoundError: 'Store delivery rates are unavailable',
      lookupError: 'Store delivery rates could not be loaded',
    });
    if (!hostMerchant.success) {
      const safeStatus = hostMerchant.status === 500 ? 503 : hostMerchant.status;
      return errorResponse(
        safeStatus === 503
          ? 'Store delivery rates could not be loaded'
          : 'Store delivery rates are unavailable',
        safeStatus
      );
    }
    hostMerchantId = String(hostMerchant.merchant.id);
  }

  let pathMerchant: Awaited<ReturnType<typeof getMerchantByIdentifierOrAlias>>;
  try {
    pathMerchant = await getMerchantByIdentifierOrAlias(slug);
  } catch {
    return errorResponse('Store delivery rates could not be loaded', 503);
  }
  if (
    !pathMerchant ||
    (hostMerchantId !== null && String(pathMerchant.id) !== hostMerchantId)
  ) {
    return errorResponse('Store delivery rates are unavailable', 404);
  }

  const currency = resolveMerchantCurrencyConfig(pathMerchant).code;
  const country = pathMerchant.country?.trim().toUpperCase();
  if (country !== 'NG' || currency.trim().toUpperCase() !== 'NGN') {
    return errorResponse(
      'Delivery estimates are available only for Nigerian stores',
      400
    );
  }

  const rates = await loadPublicMerchantRates(String(pathMerchant.id), {
    receiverCountryCode: 'NG',
    receiverState: subdivision.name,
    merchantCurrency: currency,
  });
  if (rates.loadFailed) {
    return errorResponse('Store delivery rates could not be loaded', 503);
  }

  const quoteResponse = buildMerchantOnlyQuoteResponse(rates.quotes, undefined);
  return NextResponse.json(toPublicQuoteResponse(quoteResponse), {
    headers: noStoreHeaders,
  });
}
