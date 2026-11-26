import { type NextRequest, NextResponse } from 'next/server';
import { googleMerchantFeedQuerySchema } from '@/schemas/google-merchant-feed-query';
import { generateGoogleMerchantFeedForIdentifier } from './feed-service';
import { buildGoogleMerchantFeedResponseHeaders } from './route-utils';

/**
 * Google Merchant Center Product Feed API
 *
 * Generates an XML feed compatible with Google Merchant Center.
 * Image URLs are resolved exclusively from the prevalidated
 * `product_feed_images` manifest — zero live network validation.
 *
 * @see https://support.google.com/merchants/answer/7052112
 *
 * Usage: /api/feed/google-merchant?merchant_id=xxx
 * or: /api/feed/google-merchant?merchant_slug=xxx
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawParams = {
    merchant_id: searchParams.get('merchant_id') || undefined,
    merchant_slug: searchParams.get('merchant_slug') || undefined,
  };

  const parsed = googleMerchantFeedQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid query parameters' },
      { status: 400 }
    );
  }

  const { merchant_id: merchantIdParam, merchant_slug: merchantSlug } =
    parsed.data;

  const identifier = merchantIdParam || merchantSlug || '';
  const isBySlug = !merchantIdParam && !!merchantSlug;
  const result = await generateGoogleMerchantFeedForIdentifier({
    identifier,
    isBySlug,
  });

  if (result.success) {
    return new NextResponse(result.xml, {
      status: 200,
      headers: buildGoogleMerchantFeedResponseHeaders(result.merchantId),
    });
  }

  if (result.status === 404) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ error: result.error }, { status: 500 });
}
