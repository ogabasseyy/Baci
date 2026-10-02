import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-permissions';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { updateProductDiscoveryMetadataSchema } from '@/schemas/update-product-discovery-metadata';

/** Save merchant-verified public search facts; never accept a body-selected tenant.
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
  const merchant = await getMerchantForApiRequest(supabase, user.id);
  if (!merchant)
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  if (!hasPermission(toUserAccess(merchant), 'products', 'edit')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }
  const { data, error } = await supabase
    .from('products')
    .update({ discovery_metadata: parsed.data.metadata })
    .eq('merchant_id', merchant.merchantId)
    .eq('id', parsed.data.productId)
    .select('id')
    .maybeSingle();
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
    return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  return NextResponse.json(
    { success: true, productId: data.id },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
