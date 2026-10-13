type JumiaDiscoveredShop = {
  id: string;
  name?: string | null;
  businessClients?: Array<{
    countryCode?: string | null;
  }> | null;
};

type JumiaOAuthTokenPair = {
  access_token: string;
  refresh_token?: string | null;
};

export function buildJumiaOAuthIntegrationRows(args: {
  merchantId: string;
  shops: JumiaDiscoveredShop[];
  tokens: JumiaOAuthTokenPair;
  tokenExpiresAt: Date;
  isFallbackShop: boolean;
}) {
  return args.shops.map((shop) => ({
    merchant_id: args.merchantId,
    platform: 'jumia' as const,
    shop_id: shop.id,
    marketplace_key: 'oauth',
    connection_method: 'oauth' as const,
    shop_name: shop.name || 'Jumia Shop',
    country_code: shop.businessClients?.some((bc) => bc.countryCode === 'NG')
      ? 'NG'
      : (shop.businessClients?.[0]?.countryCode ?? 'NG'),
    access_token: args.tokens.access_token,
    refresh_token: args.tokens.refresh_token ?? null,
    token_expires_at: args.tokenExpiresAt.toISOString(),
    is_active: !args.isFallbackShop,
    // OAuth integrations must not retain a Self Authorization grant when
    // the same shop switches connection methods.
    jumia_authorization_id: null,
    sync_config: {
      products: true,
      orders: true,
      stock: true,
      businessClients: shop.businessClients ?? [],
    },
  }));
}
