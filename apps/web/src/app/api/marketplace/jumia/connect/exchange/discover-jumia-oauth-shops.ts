import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaClient } from '@/lib/jumia/client';

type DiscoverJumiaOAuthShopsArgs = Readonly<{
  merchantId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  supabase: SupabaseClient;
}>;

/** Discovers OAuth shops and supplies the legacy fallback when discovery is unavailable. */
export async function discoverJumiaOAuthShops(
  args: DiscoverJumiaOAuthShopsArgs
) {
  const tempClient = new JumiaClient({
    integrationId: 'temp',
    merchantId: args.merchantId,
    shopId: 'oauth',
    marketplaceKey: 'oauth',
    accessToken: args.accessToken,
    refreshToken: args.refreshToken,
    tokenExpiresAt: args.tokenExpiresAt,
    supabase: args.supabase,
  });

  let shops: Awaited<ReturnType<typeof tempClient.getShops>>;
  try {
    shops = await tempClient.getShops();
  } catch (error) {
    console.error(
      '[Jumia Exchange] Failed to fetch shops, using fallback:',
      error
    );
    shops = [];
  }

  if (shops.length > 0) return { shops, isFallbackShop: false };

  return {
    isFallbackShop: true,
    shops: [
      {
        id: 'oauth',
        name: 'Jumia Shop',
        email: '',
        businessClients: [
          {
            name: 'Jumia Nigeria',
            code: 'jumia_ng',
            countryCode: 'NG',
            countryName: 'Nigeria',
            status: 'active',
            shortCode: 'NG',
          },
        ],
      },
    ],
  };
}
