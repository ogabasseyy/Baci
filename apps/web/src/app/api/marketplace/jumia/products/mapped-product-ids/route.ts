import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { jumiaMappedProductQuerySchema } from '@/schemas/jumia-mapped-product-query';

const MAPPED_PRODUCTS_PAGE_SIZE = 500;

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = jumiaMappedProductQuerySchema.safeParse({
    integrationId: request.nextUrl.searchParams.get('integrationId'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid integrationId' },
      { status: 400 }
    );
  }

  const merchantId = await getMerchantIdForApiUser(auth.supabase);
  if (!merchantId) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  const access = await getUserAccess(auth.supabase);
  if (!access || !hasPermission(access, 'integrations', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const featureGateResponse = await requireMerchantFeatureAccess(
    auth.supabase,
    merchantId,
    'marketplace_sync'
  );
  if (featureGateResponse) {
    return featureGateResponse;
  }

  const { data: integration, error: integrationError } = await auth.supabase
    .from('marketplace_integrations')
    .select('shop_id, marketplace_key')
    .eq('merchant_id', merchantId)
    .eq('id', parsed.data.integrationId)
    .eq('platform', 'jumia')
    .eq('is_active', true)
    .maybeSingle();

  if (integrationError) {
    return NextResponse.json(
      { error: 'Failed to load Jumia integration' },
      { status: 500 }
    );
  }

  if (!integration?.shop_id) {
    return NextResponse.json(
      { error: 'Jumia integration not found' },
      { status: 404 }
    );
  }

  const mappedProducts: Array<{
    variant_id: string | null;
    product_id: string | null;
    jumia_sku: string | null;
    sync_status: string | null;
  }> = [];
  let cursor: string | undefined;
  for (;;) {
    let query = auth.supabase
      .from('jumia_product_mappings')
      .select('id, product_id, variant_id, jumia_sku, sync_status')
      .eq('merchant_id', merchantId)
      .eq('jumia_shop_id', integration.shop_id)
      .eq('marketplace_key', integration.marketplace_key ?? 'default');
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query
      .order('id', { ascending: true })
      .limit(MAPPED_PRODUCTS_PAGE_SIZE);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load mapped products' },
        { status: 500 }
      );
    }

    const page = (data ?? []) as Array<{
      id: string;
      variant_id: string | null;
      product_id: string | null;
      jumia_sku: string | null;
      sync_status: string | null;
    }>;
    mappedProducts.push(...page);
    if (page.length < MAPPED_PRODUCTS_PAGE_SIZE) {
      break;
    }
    cursor = page.at(-1)?.id;
    if (!cursor) break;
  }

  return NextResponse.json({
    mappings: mappedProducts.flatMap((row) => {
      if (
        typeof row.product_id !== 'string' ||
        !row.product_id.trim() ||
        typeof row.jumia_sku !== 'string' ||
        !row.jumia_sku.trim() ||
        typeof row.sync_status !== 'string' ||
        !row.sync_status.trim()
      ) {
        return [];
      }
      return [
        {
          productId: row.product_id,
          variantId: row.variant_id,
          sellerSku: row.jumia_sku,
          syncStatus: row.sync_status,
        },
      ];
    }),
  });
}
