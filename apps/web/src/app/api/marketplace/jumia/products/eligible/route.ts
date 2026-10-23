import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { jumiaProductExportEligibleQuerySchema } from '@/schemas/jumia/product-export-selection';

export async function GET(request: NextRequest) {
  const parsed = jumiaProductExportEligibleQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters' },
      { status: 400 }
    );
  }

  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const access = await getUserAccess(auth.supabase);
  if (!access?.merchantId) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(access, 'integrations', 'manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const featureGateResponse = await requireMerchantFeatureAccess(
    auth.supabase,
    access.merchantId,
    'marketplace_sync'
  );
  if (featureGateResponse) return featureGateResponse;

  const { data, error } = await auth.supabase.rpc(
    'get_jumia_product_export_selection_page',
    {
      p_selection_id: parsed.data.selectionId,
      p_page: parsed.data.page,
      p_limit: parsed.data.limit,
    }
  );
  if (error || !data || typeof data !== 'object') {
    return NextResponse.json(
      { error: 'Unable to load Gaming product selection' },
      {
        status:
          error?.code === '42501' ? 404 : error?.code === '55000' ? 410 : 500,
      }
    );
  }
  return NextResponse.json(data);
}
