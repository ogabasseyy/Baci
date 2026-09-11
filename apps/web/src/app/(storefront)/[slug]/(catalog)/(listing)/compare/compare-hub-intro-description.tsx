import { getRequestScopedMerchant } from '@/lib/cached-data';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { buildCompareIndexDescription } from './compare-page-content-helpers';

export async function CompareHubIntroDescription({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }

  const merchant = await getRequestScopedMerchant(slug);
  const merchantName = merchant?.business_name?.trim();

  if (!merchantName) {
    return null;
  }

  return (
    <p
      className="text-sm text-store-background-text/70"
      data-compare-hub-intro-resolved=""
      data-cwv-lcp-support=""
    >
      {buildCompareIndexDescription(merchantName)}
    </p>
  );
}
