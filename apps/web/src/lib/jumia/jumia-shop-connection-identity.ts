import type { SafeJumiaShop } from '@/lib/jumia/self-authorization';

type ExistingIntegrationRow = {
  shop_id: string | null;
  country_code: string | null;
  marketplace_key: string | null;
  connection_method: string | null;
};

export function buildExistingJumiaShopIds(
  existing: ExistingIntegrationRow[]
): Set<string> {
  return new Set(
    existing.flatMap((row) => {
      if (!row.shop_id) return [];
      const byCountry = `${row.shop_id}:${row.country_code}`;
      if (row.connection_method === 'self_authorization') {
        if (row.marketplace_key && row.marketplace_key !== 'default') {
          return [`${row.shop_id}:${row.marketplace_key}`];
        }
        return [byCountry];
      }
      return [row.shop_id, byCountry];
    })
  );
}

export function jumiaShopConnectionIdentities(shop: SafeJumiaShop): string[] {
  const identities = [shop.id, `${shop.id}:${shop.countryCode}`];
  if (shop.selectionKey) {
    identities.push(shop.selectionKey);
  }
  if (shop.businessClientCode) {
    identities.push(`${shop.id}:${shop.businessClientCode}`);
  }
  if (shop.marketplace) {
    identities.push(`${shop.id}:${shop.marketplace}`);
  }
  return identities;
}

export function isJumiaShopAlreadyConnected(
  shop: SafeJumiaShop,
  existingShopIds: Set<string>
): boolean {
  return jumiaShopConnectionIdentities(shop).some((identity) =>
    existingShopIds.has(identity)
  );
}
