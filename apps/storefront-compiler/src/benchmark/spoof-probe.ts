import type { Miniflare } from 'miniflare';
import type { BackingCatalogProduct } from './ogabassey-catalog-fixture';
import type {
  SimulatedPostgrestOutboundPlane,
  TrustedOutboundParams,
} from './outbound-data-plane';

export const VICTIM_MERCHANT_ID = '99999999-9999-4999-8999-999999999999';
export const VICTIM_SENTINEL_PRODUCT_NAME =
  'SENTINEL_VICTIM_EXCLUSIVE_DEVICE_IPHONE';

export function registerVictimSentinelCatalog(
  plane: SimulatedPostgrestOutboundPlane
): void {
  const victimProduct: BackingCatalogProduct = {
    id: 'victim_prod_1',
    slug: 'victim-exclusive-flagship',
    name: VICTIM_SENTINEL_PRODUCT_NAME,
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    brand: 'Apple',
    condition: 'New',
    priceNgn: 999_999,
    costPriceNgn: 700_000,
    supplierInternalCode: 'SUP-VICTIM-001',
    isPublished: true,
    imageUrl: 'https://cdn.usebaci.com/victim/flagship.webp',
    imageAlt: 'Victim device',
    shortSpecs: 'iphone sentinel spec',
    variants: [
      {
        id: 'victim_var_1',
        sku: 'VIC-1',
        label: '256GB / Black',
        storage: '256GB',
        color: 'Black',
        priceNgn: 999_999,
        costPriceNgn: 700_000,
        stockQty: 5,
      },
    ],
  };
  plane.registerTenantCatalog(VICTIM_MERCHANT_ID, [victimProduct]);
}

export async function verifySpoofedTenantBlocked(options: {
  spoofIsolate: Miniflare;
  outboundPlane: SimulatedPostgrestOutboundPlane;
  trustedParams: TrustedOutboundParams;
}): Promise<boolean> {
  const { spoofIsolate, outboundPlane, trustedParams } = options;
  registerVictimSentinelCatalog(outboundPlane);

  // Confirm victim sentinel IS genuinely served when trusted dispatch binds victim tenant
  const victimControlRes = await outboundPlane.handleOutboundFetch(
    new Request('https://catalog.baci.internal/v1/search?category=smartphones'),
    { merchantId: VICTIM_MERCHANT_ID, merchantSlug: 'victim-tenant' },
    'split-availability'
  );
  const victimControlBody = await victimControlRes.text();
  if (!victimControlBody.includes(VICTIM_SENTINEL_PRODUCT_NAME)) return false;

  const spoofRes = await spoofIsolate.dispatchFetch(
    `https://ogabassey.mybaci.store/search?q=iphone&merchantId=${VICTIM_MERCHANT_ID}`,
    { headers: { 'x-baci-merchant-slug': 'victim-tenant' } }
  );
  const spoofHtml = await spoofRes.text();

  const directOutboundSpoofRes = await outboundPlane.handleOutboundFetch(
    new Request(
      `https://catalog.baci.internal/v1/search?category=smartphones&merchantId=${VICTIM_MERCHANT_ID}`
    ),
    trustedParams,
    'split-availability'
  );
  const directBody = await directOutboundSpoofRes.text();

  return (
    spoofRes.status === 200 &&
    spoofHtml.includes('Apple') &&
    !spoofHtml.includes(VICTIM_SENTINEL_PRODUCT_NAME) &&
    directOutboundSpoofRes.headers.get('x-baci-tenant') ===
      trustedParams.merchantId &&
    directBody.includes('Apple') &&
    !directBody.includes(VICTIM_SENTINEL_PRODUCT_NAME) &&
    outboundPlane.telemetry.spoofedTenantIgnoredCount >= 1
  );
}
