import { NextResponse } from 'next/server';
import { getCachedGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { getCachedOpenAIFeedData } from '@/app/api/feed/openai/feed-data';
import { getGooglePlacesApiKey, getRootDomain } from '@/env';
import { buildRequestBaseUrl } from '@/lib/storefront-host';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { buildAgentCommerceTrustReadiness } from '@/lib/storefront-trust/build-agent-commerce-trust-readiness';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { enrichMerchantReviewAuthority } from '@/lib/storefront-trust/enrich-merchant-review-authority';

const AGENT_TRUST_SCHEMA_VERSION = '2026-05-20';
const ROOT_DOMAIN = (getRootDomain() || 'usebaci.com').toLowerCase();
const AGENT_TRUST_CACHE_CONTROL = 'public, max-age=60';
const AGENT_TRUST_CDN_CACHE_CONTROL =
  'public, s-maxage=1800, stale-while-revalidate=86400';

// Cold agent-trust misses build feed parity and review signals; keep the
// machine-readable route within Vercel's documented function-duration config
// instead of letting crawlers hit the platform's 15s default timeout.
export const maxDuration = 60;

export async function GET(request: Request) {
  const merchantResolution = await resolveStorefrontMerchantFromRequest({
    request,
    rootDomain: ROOT_DOMAIN,
    notFoundError:
      'Agent trust readiness is only available on storefront hosts',
    lookupError: 'Failed to resolve storefront for agent trust readiness',
  });

  if (!merchantResolution.success) {
    if (merchantResolution.status === 500) {
      console.error('AGENT_TRUST_READINESS_ERROR:', merchantResolution.cause);
    }

    return NextResponse.json(
      { error: merchantResolution.error },
      {
        status: merchantResolution.status,
        headers:
          merchantResolution.status === 404
            ? {
                'Cache-Control': AGENT_TRUST_CACHE_CONTROL,
                'Vercel-CDN-Cache-Control': AGENT_TRUST_CDN_CACHE_CONTROL,
              }
            : {
                'Cache-Control': 'no-store',
              },
      }
    );
  }

  const { merchant } = merchantResolution;
  const baseUrl = buildRequestBaseUrl(request);

  try {
    const [openAiFeedData, googleFeedData] = await Promise.all([
      getCachedOpenAIFeedData(merchant.id, true),
      getCachedGoogleMerchantFeedData(merchant.id, merchant.slug),
    ]);
    const baseTrustProfile = buildMerchantTrustProfile(merchant, baseUrl);
    const trustProfile = getGooglePlacesApiKey()
      ? await enrichMerchantReviewAuthority(baseTrustProfile)
      : baseTrustProfile;

    return NextResponse.json(
      {
        schema_version: AGENT_TRUST_SCHEMA_VERSION,
        platform: 'baci',
        store: {
          slug: merchant.slug,
          name: merchant.business_name,
          canonical_origin: baseUrl,
        },
        trust: buildAgentCommerceTrustReadiness({
          baseUrl,
          googleFeedData,
          merchant,
          openAiFeedData,
          trustProfile,
        }),
      },
      {
        headers: {
          'Cache-Control': AGENT_TRUST_CACHE_CONTROL,
          'Vercel-CDN-Cache-Control': AGENT_TRUST_CDN_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error('AGENT_TRUST_READINESS_ERROR:', error);

    return NextResponse.json(
      { error: 'Failed to build agent trust readiness' },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
