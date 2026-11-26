import { type NextRequest, NextResponse } from 'next/server';
import { generateGoogleMerchantFeedForIdentifier } from '@/app/api/feed/google-merchant/feed-service';
import { buildGoogleMerchantFeedResponseHeaders } from '@/app/api/feed/google-merchant/route-utils';
import { getRootDomain } from '@/env';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';

// Cold merchant feeds can exceed the platform default function duration after
// deploy cache misses; keep this aligned with /feeds/agent-products.jsonl.
export const maxDuration = 60;

const ROOT_DOMAIN = (getRootDomain() || 'usebaci.com').toLowerCase();

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildXmlErrorResponse(error: string, status: number): NextResponse {
  return new NextResponse(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<error>',
      `  <message>${escapeXmlText(error)}</message>`,
      '</error>',
    ].join('\n'),
    {
      status,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    }
  );
}

export async function GET(request: NextRequest) {
  const resolution = await resolveStorefrontMerchantFromRequest({
    request,
    rootDomain: ROOT_DOMAIN,
    notFoundError: 'Google Merchant feed is only available on storefront hosts',
    lookupError: 'Failed to resolve storefront for Google Merchant feed',
  });

  if (!resolution.success) {
    if (resolution.status === 500) {
      console.error('GOOGLE_MERCHANT_PUBLIC_FEED_ERROR:', resolution.cause);
    }

    return buildXmlErrorResponse(resolution.error, resolution.status);
  }

  const result = await generateGoogleMerchantFeedForIdentifier({
    identifier: resolution.merchant.slug,
    isBySlug: true,
  });

  if (!result.success) {
    return buildXmlErrorResponse(result.error, result.status);
  }

  return new NextResponse(result.xml, {
    status: 200,
    headers: buildGoogleMerchantFeedResponseHeaders(
      result.merchantId ?? resolution.merchant.id
    ),
  });
}
