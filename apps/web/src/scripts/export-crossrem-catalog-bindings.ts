import { collectGoogleMerchantListings } from '@/app/api/feed/google-merchant/collect-google-merchant-listings';
import { getGoogleMerchantFeedData } from '@/app/api/feed/google-merchant/feed-data';
import { buildMerchantBaseUrl } from '@/app/api/feed/google-merchant/route-utils';
import { seedBindingCandidates } from '@/app/api/partners/v1/catalog/seed-bindings';
import { isUuid, resolveFeedMerchant } from '@/lib/feed-identifier';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

async function main() {
  const merchantId = process.argv[2];
  if (!merchantId || !isUuid(merchantId)) {
    console.error('Pass the approved merchant UUID.');
    process.exitCode = 1;
    return;
  }

  const merchant = await resolveFeedMerchant(merchantId, false);
  if (
    merchant.id !== merchantId ||
    resolveMerchantCurrencyConfig(merchant).code !== 'NGN'
  ) {
    throw new Error('CrossRem merchant unavailable');
  }

  const data = await getGoogleMerchantFeedData(merchant.id, merchant.slug);
  const rows = collectGoogleMerchantListings(
    data.products,
    merchant,
    buildMerchantBaseUrl({ slug: data.slug, custom_domain: data.custom_domain }),
    data.imageManifest
  );
  if (!rows.length) throw new Error('Merchant catalog is empty');

  const candidates = seedBindingCandidates(rows);
  process.stdout.write(
    `${JSON.stringify({ merchant_id: merchant.id, ...candidates }, null, 2)}\n`
  );
}

main().catch(() => {
  console.error('Unable to export CrossRem binding candidates.');
  process.exitCode = 1;
});
