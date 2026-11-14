import { type NextRequest, NextResponse } from 'next/server';
import { mapDetailedCachedProductToProduct } from '@/app/(storefront)/[slug]/(catalog)/(pdp)/products/[productSlug]/detailed-product-mapper';
import { getRootDomain } from '@/env';
import { CURRENCY_SYMBOLS } from '@/lib/currency-meta';
import { logger } from '@/lib/logger';
import { resolvePayoutOnlyCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { getUncachedProductWithDetails } from '@/lib/uncached-storefront-product';
import { chatProductResponseSchema } from '@/schemas/chat-product-response';
import { chatProductRouteParamsSchema } from '@/schemas/chat-product-route-params';
import { projectChatProduct } from './safe-product-projection';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; productSlug: string }> }
) {
  const parsed = chatProductRouteParamsSchema.safeParse(await context.params);
  if (!parsed.success)
    return noStoreJson({ error: 'Invalid product' }, { status: 400 });
  const merchant = await resolveStorefrontMerchantFromRequest({
    request,
    rootDomain: getRootDomain() || 'usebaci.com',
    fallbackIdentifier: parsed.data.slug,
    notFoundError: 'Store not found',
    lookupError: 'Store unavailable',
  });
  if (!merchant.success)
    return noStoreJson({ error: merchant.error }, { status: merchant.status });
  const currency = resolvePayoutOnlyCurrencyConfig(merchant.merchant);
  if (!isSupportedCurrency(currency.code))
    return noStoreJson(
      { error: 'Store currency unavailable' },
      { status: 503 }
    );
  try {
    const raw = await getUncachedProductWithDetails(
      merchant.merchant.id,
      parsed.data.productSlug
    );
    if (!raw)
      return noStoreJson({ error: 'Product not found' }, { status: 404 });
    const product = mapDetailedCachedProductToProduct(
      raw,
      merchant.merchant.id
    );
    if (product.status !== 'active')
      return noStoreJson({ error: 'Product not found' }, { status: 404 });
    const responseBody = {
      product: {
        ...projectChatProduct(product),
        currency,
      },
    };
    const parsedResponse = chatProductResponseSchema.safeParse(responseBody);
    if (!parsedResponse.success) {
      logger.error({
        message: 'Chat product response failed validation',
        merchantId: merchant.merchant.id,
        productSlug: parsed.data.productSlug,
        issuePaths: parsedResponse.error.issues.map((issue) => issue.path),
      });
      return noStoreJson({ error: 'Product unavailable' }, { status: 503 });
    }
    return noStoreJson(responseBody);
  } catch (error) {
    logger.error({
      message: 'Chat product lookup failed',
      merchantId: merchant.merchant.id,
      productSlug: parsed.data.productSlug,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return noStoreJson({ error: 'Product unavailable' }, { status: 503 });
  }
}

function isSupportedCurrency(code?: string): boolean {
  if (!code || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    if (
      typeof Intl.supportedValuesOf === 'function' &&
      Intl.supportedValuesOf('currency').includes(code)
    ) {
      return true;
    }
  } catch {
    return code in CURRENCY_SYMBOLS;
  }
  return code in CURRENCY_SYMBOLS;
}

function noStoreJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' },
  });
}
