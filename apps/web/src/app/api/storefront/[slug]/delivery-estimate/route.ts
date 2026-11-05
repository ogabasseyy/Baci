import { type NextRequest, NextResponse } from 'next/server';
import { loadPublicMerchantRates } from '@/app/api/shipping/quotes/load-public-merchant-rates';
import { toPublicQuoteResponse } from '@/app/api/shipping/quotes/public-quote-response';
import { buildMerchantOnlyQuoteResponse } from '@/app/api/shipping/quotes/quote-source-orchestration';
import { getRootDomain } from '@/env';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantByIdentifierOrAlias } from '@/lib/get-merchant-by-identifier-or-alias';
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

  const merchant = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: slug,
    request,
    rootDomain: getRootDomain() || 'usebaci.com',
    notFoundError: 'Store delivery rates are unavailable',
    lookupError: 'Store delivery rates could not be loaded',
  });
  if (!merchant.success) {
    const safeStatus = merchant.status === 500 ? 503 : merchant.status;
    return errorResponse(
      safeStatus === 503
        ? 'Store delivery rates could not be loaded'
        : 'Store delivery rates are unavailable',
      safeStatus
    );
  }

  // A host-resolved storefront is authoritative, but the path still names a
  // merchant. Require both identifiers to resolve to the same merchant.
  let pathMerchant: Awaited<ReturnType<typeof getMerchantByIdentifierOrAlias>>;
  try {
    pathMerchant = await getMerchantByIdentifierOrAlias(slug);
  } catch {
    return errorResponse('Store delivery rates could not be loaded', 503);
  }
  if (
    !pathMerchant ||
    String(pathMerchant.id) !== String(merchant.merchant.id)
  ) {
    return errorResponse('Store delivery rates are unavailable', 404);
  }

  const currency = resolveMerchantCurrencyConfig(merchant.merchant).code;
  const country = merchant.merchant.country?.trim().toUpperCase();
  if (country !== 'NG' || currency.trim().toUpperCase() !== 'NGN') {
    return errorResponse(
      'Delivery estimates are available only for Nigerian stores',
      400
    );
  }

  const rates = await loadPublicMerchantRates(String(merchant.merchant.id), {
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
