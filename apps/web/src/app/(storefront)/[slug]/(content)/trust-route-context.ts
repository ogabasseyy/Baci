import { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';

export async function getTrustRouteContext(
  slug: string,
  _options: { requestScopedUrl?: boolean } = {}
) {
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return null;
  }

  const baseUrl = buildStoreUrl(merchant);
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);

  return { merchant, baseUrl, trustProfile };
}

export function getContactHref(
  merchant: NonNullable<Awaited<ReturnType<typeof getRequestScopedMerchant>>>,
  baseUrl: string
): string | undefined {
  return merchant.pages?.contact?.trim() ||
    merchant.email?.trim() ||
    merchant.phone?.trim()
    ? `${baseUrl}/contact`
    : undefined;
}
