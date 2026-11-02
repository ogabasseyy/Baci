import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { hasPermission } from '@/lib/api-permissions';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  ExternalWaybillError,
  previewExternalGiglWaybill,
} from '@/lib/shipping/external-gigl-waybill-preview';
import { persistExternalGiglWaybill } from '@/lib/shipping/persist-external-gigl-waybill';
import {
  giglExternalWaybillOrderIdSchema,
  giglExternalWaybillRequestSchema,
} from '@/schemas/gigl-external-waybill';

type Params = { params: Promise<{ id: string }> };

function errorResponse(error: string, status: number, code?: string) {
  return NextResponse.json({ error, ...(code ? { code } : {}) }, { status });
}

// POST /api/orders/[id]/shipping/gigl-waybill
// Attach a waybill that staff booked directly in GIG's own app. `preview`
// only reads GIG; `link` re-checks GIG and creates the tracked shipment.
export async function POST(request: NextRequest, context: Params) {
  try {
    // Authenticate first so an unauthenticated caller always gets 401.
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return errorResponse('Unauthorized', 401);
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return csrfResponse ?? errorResponse('CSRF validation failed', 403);
    }

    const { id } = await context.params;
    const orderId = giglExternalWaybillOrderIdSchema.safeParse(id);
    if (!orderId.success) {
      return errorResponse('Invalid order id', 400, 'INVALID_ORDER_ID');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', 400, 'INVALID_JSON');
    }
    const parsed = giglExternalWaybillRequestSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        parsed.error.issues[0]?.message ?? 'Invalid request',
        400,
        'INVALID_REQUEST'
      );
    }

    const merchant = await getMerchantForApiRequest(
      auth.supabase,
      auth.user.id
    );
    if (!merchant) {
      return errorResponse('Merchant not found', 404);
    }
    const access = toUserAccess(merchant);
    if (
      !hasPermission(access, 'orders', 'fulfill') &&
      !hasPermission(access, 'orders', 'edit')
    ) {
      return errorResponse('Forbidden', 403);
    }

    const { action, waybill } = parsed.data;
    const { lookup, orderSnapshot, preview } = await previewExternalGiglWaybill(
      {
        merchantId: merchant.merchantId,
        orderId: orderId.data,
        supabase: auth.supabase,
        waybill,
      }
    );
    if (action === 'preview') {
      return NextResponse.json({ preview });
    }

    if (!preview.linkable) {
      return NextResponse.json(
        {
          error:
            'The receiver or destination on this waybill does not match this order.',
          code: 'RECEIVER_MISMATCH',
          preview,
        },
        { status: 409 }
      );
    }

    const { shipmentId } = await persistExternalGiglWaybill({
      lookup,
      merchantId: merchant.merchantId,
      orderId: orderId.data,
      orderSnapshot,
      supabase: auth.supabase,
      waybill,
    });
    return NextResponse.json({
      success: true,
      shipmentId,
      trackingNumber: waybill,
      preview,
    });
  } catch (error) {
    if (error instanceof ExternalWaybillError) {
      return errorResponse(error.message, error.status, error.code);
    }
    // Log only the error type: messages can carry provider or customer data.
    console.error('Error attaching external GIG waybill', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return errorResponse('Failed to attach GIG waybill', 500);
  }
}
