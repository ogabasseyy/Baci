import { type NextRequest, NextResponse } from 'next/server';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import {
  buildPickupItems,
  buildPickupSender,
} from '@/lib/repairs/pickup-shipment-utils';
import { quoteRepairPickup } from '@/lib/repairs/quote-repair-pickup';
import { getRepairCenterAddress } from '@/lib/repairs/repair-center-address';
import { repairPickupCustomerPhoneError } from '@/lib/repairs/repair-pickup-customer-phone';
import { resolveRepairsCatalogMerchant } from '@/lib/repairs/repairs-catalog-access';
import { startMobileRepairPickupPayment } from '@/lib/repairs/start-mobile-repair-pickup-payment';
import { mobileRepairPickupSchema } from '@/schemas/mobile-repair-pickup';
import { repairsDevicesRouteParamsSchema } from '@/schemas/repair-catalog';

// Guest mobile adapter to the same paid-pickup core as the storefront wizard.
// This endpoint never books a carrier: only the verified payment webhook does.
// CSRF uses proxy.ts's centralized Origin check, like repairs/book. Native
// requests have no Origin; neither route relies on an ambient customer session.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const params = repairsDevicesRouteParamsSchema.safeParse(
    await context.params
  );
  const input = mobileRepairPickupSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!params.success || !input.success) {
    return NextResponse.json(
      { error: 'Enter valid repair and pickup details.' },
      { status: 400 }
    );
  }
  const phoneError = repairPickupCustomerPhoneError(
    input.data.data.customerPhone
  );
  if (phoneError)
    return NextResponse.json({ error: phoneError }, { status: 400 });
  if (
    !(await ensureActionRateLimit('mobile-repair-pickup', {
      requests: 10,
      windowMs: 60_000,
    }))
  ) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again shortly.' },
      { status: 429 }
    );
  }
  try {
    const merchant = await resolveRepairsCatalogMerchant(params.data.slug);
    if (!merchant?.enabled) {
      return NextResponse.json(
        { error: 'Repairs unavailable.' },
        { status: 404 }
      );
    }
    if (input.data.action === 'pay') {
      const result = await startMobileRepairPickupPayment({
        data: input.data.data,
        requestId: input.data.requestId,
        expectedPickupFee: input.data.expectedPickupFee,
        resumeToken: input.data.resumeToken,
        merchantId: merchant.merchantId,
        merchantIdentifier: params.data.slug,
      });
      // Preserve resumable failures and changed-price responses for the app.
      return NextResponse.json(result);
    }
    const data = input.data.data;
    const source = {
      customer_name: data.customerName,
      customer_email: data.customerEmail,
      customer_phone: data.customerPhone,
      device_type: data.deviceType,
      device_model: data.deviceModel,
      pickup_address: data.pickupAddress ?? null,
      quoted_price: null,
    };
    const sender = buildPickupSender(source);
    const receiver = await getRepairCenterAddress(merchant.merchantId);
    if (!sender || !receiver) {
      return NextResponse.json(
        { error: 'Pickup unavailable. Please choose drop-off.' },
        { status: 409 }
      );
    }
    const { quote } = await quoteRepairPickup({
      sender,
      receiver,
      merchantId: merchant.merchantId,
      items: buildPickupItems(source),
    });
    if (!quote) {
      return NextResponse.json(
        {
          error:
            'GIGL pickup is unavailable for this address. Please choose drop-off.',
        },
        { status: 409 }
      );
    }
    // Never return the carrier payload or private repair-centre receiver.
    return NextResponse.json({ price: quote.price, currency: quote.currency });
  } catch {
    return NextResponse.json(
      { error: 'Pickup is temporarily unavailable. Please try again.' },
      { status: 503 }
    );
  }
}
