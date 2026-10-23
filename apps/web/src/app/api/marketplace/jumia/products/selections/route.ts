import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import {
  createJumiaProductExportSelectionSchema,
  jumiaProductExportSelectionRpcRowSchema,
} from '@/schemas/jumia/product-export-selection';

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = createJumiaProductExportSelectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
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
    'create_jumia_product_export_selection',
    {
      p_merchant_id: access.merchantId,
      p_source_category_id: parsed.data.sourceCategoryId,
    }
  );
  if (error || !Array.isArray(data) || !data[0]) {
    return NextResponse.json(
      { error: 'Unable to create Gaming product selection' },
      { status: error?.code === '22023' ? 400 : 500 }
    );
  }

  const rpcRow: unknown = data[0];
  const selectionResult =
    jumiaProductExportSelectionRpcRowSchema.safeParse(rpcRow);
  if (!selectionResult.success) {
    return NextResponse.json(
      { error: 'Unable to create Gaming product selection' },
      { status: 500 }
    );
  }
  const selection = selectionResult.data;
  return NextResponse.json(
    {
      selectionId: selection.selection_id,
      total: selection.total,
      capturedAt: selection.captured_at,
      expiresAt: selection.expires_at,
    },
    { status: 201 }
  );
}
