import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-permissions';
import { checkCsrfProtection } from '@/lib/csrf';
import { proposeDiscoveryFacts } from '@/lib/discovery-facts-review';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  discoveryFactsQuerySchema,
  updateProductDiscoveryMetadataSchema,
} from '@/schemas/update-product-discovery-metadata';

export async function GET(request: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = discoveryFactsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
  const { cursor, merchantId } = parsed.data;
  const merchant = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: merchantId,
  });
  if (!merchant)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(toUserAccess(merchant), 'products', 'edit'))
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  let query = supabase
    .from('products')
    .select(
      'id,name,category,metadata,discovery_metadata,specifications,mpn,color'
    )
    .eq('merchant_id', merchant.merchantId)
    .order('id')
    .limit(21);
  if (cursor) query = query.gt('id', cursor);
  const { data, error } = await query;
  if (error)
    return NextResponse.json(
      { error: 'Could not load catalog facts' },
      { status: 500 }
    );
  const rows = data ?? [];
  return NextResponse.json(
    {
      products: rows.slice(0, 20).map((row) => ({
        id: row.id,
        name: row.name,
        expectedMetadata: row.discovery_metadata,
        ...proposeDiscoveryFacts(row),
        specifications: row.specifications,
        mpn: row.mpn,
        color: row.color,
      })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Save merchant-verified public search facts; authorize the requested merchant before querying products.
 * Full replacement: clients must send the complete document, since omitted
 * keys are cleared rather than merged. */
export async function PUT(request: NextRequest) {
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = updateProductDiscoveryMetadataSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const merchant = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: parsed.data.merchantId,
  });
  if (!merchant)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(toUserAccess(merchant), 'products', 'edit')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  let update = supabase
    .from('products')
    .update({ discovery_metadata: parsed.data.metadata })
    .eq('merchant_id', merchant.merchantId)
    .eq('id', parsed.data.productId);
  if (parsed.data.expectedMetadata !== undefined) {
    update =
      parsed.data.expectedMetadata === null
        ? update.is('discovery_metadata', null)
        : update.eq(
            'discovery_metadata',
            JSON.stringify(parsed.data.expectedMetadata)
          );
  }
  const { data, error } = await update.select('id').maybeSingle();
  if (
    error?.code === '23514' &&
    error.message?.includes('products_discovery_metadata_object')
  )
    return NextResponse.json(
      { error: 'Discovery facts exceed the supported storage limit' },
      { status: 400 }
    );
  if (error)
    return NextResponse.json(
      { error: 'Could not update discovery facts' },
      { status: 500 }
    );
  if (!data)
    return NextResponse.json(
      {
        error:
          parsed.data.expectedMetadata !== undefined
            ? 'Facts changed or product unavailable. Reload before saving.'
            : 'Product not found',
      },
      { status: parsed.data.expectedMetadata !== undefined ? 409 : 404 }
    );
  return NextResponse.json(
    { success: true, productId: data.id },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
