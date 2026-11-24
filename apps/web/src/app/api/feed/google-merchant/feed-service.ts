import { cacheLife, cacheTag } from 'next/cache';
import {
  type FeedMerchantRecord,
  MerchantNotFoundError,
  resolveFeedMerchant,
} from '@/lib/feed-identifier';
import { logger } from '@/lib/logger';
import { generateGoogleMerchantFeed } from './feed-builder';
import { getCachedGoogleMerchantFeedData } from './feed-data';
import { buildMerchantBaseUrl } from './route-utils';

const GOOGLE_MERCHANT_FEED_XML_CACHE_VERSION = 'google-merchant-xml-v1';

async function getCachedGoogleMerchantFeedXml(
  resolvedMerchant: FeedMerchantRecord,
  cacheVersion: string
): Promise<string> {
  'use cache';
  void cacheVersion;
  cacheLife('products');
  cacheTag('google-merchant-feed', `merchant-feed-${resolvedMerchant.id}`);

  const { custom_domain, slug, products, imageManifest } =
    await getCachedGoogleMerchantFeedData(
      resolvedMerchant.id,
      resolvedMerchant.slug
    );

  const merchant = {
    ...resolvedMerchant,
    custom_domain,
  };
  const baseUrl = buildMerchantBaseUrl({ slug, custom_domain });

  return generateGoogleMerchantFeed(products, merchant, baseUrl, imageManifest);
}

type GoogleMerchantFeedServiceSuccess = {
  success: true;
  xml: string;
};

type GoogleMerchantFeedServiceFailure = {
  success: false;
  error: string;
  status: 404 | 500;
  cause: unknown;
};

export type GoogleMerchantFeedServiceResult =
  | GoogleMerchantFeedServiceSuccess
  | GoogleMerchantFeedServiceFailure;

export async function generateGoogleMerchantFeedForIdentifier({
  identifier,
  isBySlug,
}: {
  identifier: string;
  isBySlug: boolean;
}): Promise<GoogleMerchantFeedServiceResult> {
  try {
    const resolvedMerchant = await resolveFeedMerchant(identifier, isBySlug);
    const xml = await getCachedGoogleMerchantFeedXml(
      resolvedMerchant,
      GOOGLE_MERCHANT_FEED_XML_CACHE_VERSION
    );

    return {
      success: true,
      xml,
    };
  } catch (error) {
    if (error instanceof MerchantNotFoundError) {
      return {
        success: false,
        status: 404,
        error: 'Merchant not found',
        cause: error,
      };
    }

    logger.error({
      message: 'Failed to generate Google Merchant feed',
      error,
      identifier,
      isBySlug,
    });

    return {
      success: false,
      status: 500,
      error: 'Failed to generate feed',
      cause: error,
    };
  }
}
