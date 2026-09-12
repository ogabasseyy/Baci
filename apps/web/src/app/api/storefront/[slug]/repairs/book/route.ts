import { type NextRequest, NextResponse } from 'next/server';
import { notifyRepairBooking } from '@/lib/repair-notifications';
import {
  createRepairBooking,
  type RepairBookingErrorCode,
} from '@/lib/repairs/create-repair-core';
import { resolveRepairsCatalogMerchant } from '@/lib/repairs/repairs-catalog-access';
import { repairBookingSchema } from '@/lib/validations/repair';
import { repairsDevicesRouteParamsSchema } from '@/schemas/repair-catalog';

/**
 * Guest-callable booking endpoint for the mobile storefront (server actions
 * aren't callable from React Native). CSRF is handled the same way as
 * `api/discount-codes/validate`: proxy.ts only enforces the Origin check when
 * an Origin header is present, which mobile requests never send. Defense
 * layers here are the app-layer rate limit + Zod validation (both inside the
 * shared `createRepairBooking` core) and the booking RPC's own server-side
 * merchant/active-quote validation and price snapshot.
 */
const ERROR_STATUS: Record<RepairBookingErrorCode, number> = {
  rate_limited: 429,
  invalid_merchant: 400,
  validation_failed: 400,
  not_found: 404,
  unavailable: 409,
  unknown: 500,
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const parsedParams = repairsDevicesRouteParamsSchema.safeParse(
      await params
    );
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: 'Invalid route parameters',
          details: parsedParams.error.flatten(),
        },
        { status: 400 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const merchant = await resolveRepairsCatalogMerchant(
      parsedParams.data.slug
    );
    if (!merchant?.enabled) {
      return NextResponse.json(
        { error: 'Repairs catalogue not available' },
        { status: 404 }
      );
    }

    // Validated once here (typed access for the notify payload below) and
    // again inside `createRepairBooking` (defense in depth — the RPC is the
    // real authority, this route is just one of two callers of the shared
    // schema).
    const parsedBody = repairBookingSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: { fieldErrors: parsedBody.error.flatten().fieldErrors },
        },
        { status: 400 }
      );
    }

    if (parsedBody.data.serviceType === 'pickup') {
      return NextResponse.json(
        { error: 'Courier pickup must be paid before booking.' },
        { status: 409 }
      );
    }

    const result = await createRepairBooking(
      parsedBody.data,
      merchant.merchantId
    );

    if (!result.success) {
      const status = ERROR_STATUS[result.code] ?? 500;
      return NextResponse.json(
        {
          error: result.error,
          ...(result.fieldErrors
            ? { details: { fieldErrors: result.fieldErrors } }
            : {}),
        },
        { status }
      );
    }

    // Same merchant push + customer ticket-confirmation email the web wizard
    // triggers after `createRepair` — best-effort, never throws.
    await notifyRepairBooking({
      customerEmail: parsedBody.data.customerEmail,
      customerName: parsedBody.data.customerName,
      deviceModel: parsedBody.data.deviceModel,
      deviceType: parsedBody.data.deviceType,
      merchantId: merchant.merchantId,
      pickupAddress: parsedBody.data.pickupAddress ?? null,
      quoteId: parsedBody.data.quoteId ?? null,
      repairId: result.id,
      serviceType: parsedBody.data.serviceType,
      ticketNumber: result.ticketNumber,
    });

    return NextResponse.json(
      { id: result.id, ticketNumber: result.ticketNumber },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/storefront/[slug]/repairs/book:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
