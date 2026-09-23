import { customAlphabet } from 'nanoid';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { initializeTransaction } from '@/lib/paystack';
import { bindRepairPickupPendingPaymentReference } from '@/lib/repairs/bind-repair-pickup-pending-payment-reference';
import { createRepairBooking } from '@/lib/repairs/create-repair-core';
import { findResumablePickupRepair } from '@/lib/repairs/find-resumable-repair-pickup';
import { markRepairPickupAwaitingPayment } from '@/lib/repairs/mark-repair-pickup-awaiting-payment';
import {
  buildPickupItems,
  buildPickupSender,
} from '@/lib/repairs/pickup-shipment-utils';
import { quoteRepairPickup } from '@/lib/repairs/quote-repair-pickup';
import { getRepairCenterAddress } from '@/lib/repairs/repair-center-address';
import { repairPickupCustomerPhoneError } from '@/lib/repairs/repair-pickup-customer-phone';
import { repairPickupPaymentClaims } from '@/lib/repairs/repair-pickup-payment-claim';
import { repairPickupResumeClaims } from '@/lib/repairs/repair-pickup-resume-claim';
import { resolveRepairPickupPaymentMerchant } from '@/lib/repairs/resolve-repair-pickup-payment-merchant';
import type {
  StartRepairPickupPaymentInput,
  StartRepairPickupPaymentResult,
} from '@/lib/repairs/start-repair-pickup-payment-types';
import { createClient } from '@/lib/supabase/server';
import { repairBookingSchema } from '@/lib/validations/repair';
import {
  repairMerchantIdentifierSchema,
  repairMerchantIdSchema,
  repairPickupExpectedFeeSchema,
} from '@/schemas/repair-actions';

const createReference = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  16
);

export async function startRepairPickupPayment({
  data,
  expectedPickupFee,
  merchantId,
  merchantIdentifier,
  resumeToken,
}: StartRepairPickupPaymentInput): Promise<StartRepairPickupPaymentResult> {
  const allowed = await ensureActionRateLimit('repair-pickup-payment', {
    requests: 5,
    windowMs: 60_000,
  });
  if (!allowed) {
    return {
      success: false,
      code: 'rate_limited',
      error: 'Too many payment attempts. Please try again shortly.',
    };
  }

  const parsedMerchantId = repairMerchantIdSchema.safeParse(merchantId);
  const parsedMerchantIdentifier =
    repairMerchantIdentifierSchema.safeParse(merchantIdentifier);
  const parsedExpectedPickupFee =
    repairPickupExpectedFeeSchema.safeParse(expectedPickupFee);
  const parsed = repairBookingSchema.safeParse(data);
  if (
    !parsedMerchantId.success ||
    !parsedMerchantIdentifier.success ||
    !parsedExpectedPickupFee.success ||
    !parsed.success ||
    parsed.data.serviceType !== 'pickup'
  ) {
    return {
      success: false,
      code: 'validation_failed',
      error: 'Enter valid repair and pickup details.',
    };
  }

  // Schema allows separator padding (e.g. "0803------"); GIGL needs real digits.
  const phoneError = repairPickupCustomerPhoneError(parsed.data.customerPhone);
  if (phoneError) {
    return {
      success: false,
      code: 'validation_failed',
      error: phoneError,
    };
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return {
      success: false,
      code: 'payment_initialization_failed',
      error: 'Pickup payment is unavailable right now. Please try again later.',
    };
  }

  const supabase = await createClient();
  const merchant = await resolveRepairPickupPaymentMerchant({
    merchantId: parsedMerchantId.data,
    merchantSlug: parsedMerchantIdentifier.data,
    supabase,
  });
  if (!merchant) {
    return {
      success: false,
      code: 'not_found',
      error: 'Store not found.',
    };
  }

  const receiver = await getRepairCenterAddress(merchant.id);
  const sender = buildPickupSender({
    customer_email: parsed.data.customerEmail,
    customer_name: parsed.data.customerName,
    customer_phone: parsed.data.customerPhone,
    device_model: parsed.data.deviceModel,
    device_type: parsed.data.deviceType,
    pickup_address: parsed.data.pickupAddress ?? null,
    quoted_price: null,
  });
  if (!receiver || !sender) {
    return {
      success: false,
      code: 'pickup_unavailable',
      error: 'Courier pickup is not available for this address.',
    };
  }

  const items = buildPickupItems({
    customer_email: parsed.data.customerEmail,
    customer_name: parsed.data.customerName,
    customer_phone: parsed.data.customerPhone,
    device_model: parsed.data.deviceModel,
    device_type: parsed.data.deviceType,
    pickup_address: parsed.data.pickupAddress ?? null,
    quoted_price: null,
  });
  let quoteResult: Awaited<ReturnType<typeof quoteRepairPickup>>;
  try {
    quoteResult = await quoteRepairPickup({
      items,
      merchantId: merchant.id,
      receiver,
      sender,
    });
  } catch (error) {
    console.error('Repair pickup quote failed during payment start:', error);
    return {
      success: false,
      code: 'pickup_unavailable',
      error: 'Courier pickup is not available for this address.',
    };
  }
  const { quote } = quoteResult;
  if (!quote) {
    return {
      success: false,
      code: 'pickup_unavailable',
      error: 'Courier pickup is not available for this address.',
    };
  }

  const expectedKobo = Math.round(parsedExpectedPickupFee.data * 100);
  const amountKobo = Math.round(quote.price * 100);
  if (expectedKobo !== amountKobo) {
    return {
      success: false,
      code: 'quote_changed',
      error: 'The pickup price changed. Review the new price before paying.',
      quote: {
        formattedPrice: `₦${quote.price.toLocaleString()}`,
        price: quote.price,
      },
    };
  }

  const resumed = await findResumablePickupRepair({
    input: parsed.data,
    merchantId: merchant.id,
    resumeToken,
    secret,
  });
  if (resumed.kind === 'invalid_resume') {
    return {
      success: false,
      code: 'resume_invalid',
      error: resumed.error,
    };
  }
  if (resumed.kind === 'error') {
    return {
      success: false,
      code: 'lookup_failed',
      error: resumed.error,
    };
  }

  const repair =
    resumed.kind === 'found'
      ? resumed.repair
      : await createRepairBooking(parsed.data, merchant.id);
  if (!repair.success) return repair;

  const nextResumeToken = repairPickupResumeClaims.create(
    {
      customerEmail: parsed.data.customerEmail,
      issuedAt: Date.now(),
      merchantId: merchant.id,
      repairId: repair.id,
    },
    secret
  );

  const awaiting = await markRepairPickupAwaitingPayment({
    merchantId: merchant.id,
    repairId: repair.id,
  });
  if (!awaiting.ok) {
    return {
      success: false,
      code: 'payment_initialization_failed',
      error: awaiting.error,
      id: repair.id,
      ticketNumber: repair.ticketNumber,
      resumeToken: nextResumeToken,
    };
  }

  const reference = `RPU-${createReference()}`;
  const bound = await bindRepairPickupPendingPaymentReference({
    merchantId: merchant.id,
    reference,
    repairId: repair.id,
  });
  if (!bound.ok) {
    return {
      success: false,
      code: 'payment_initialization_failed',
      error: bound.error,
      id: repair.id,
      ticketNumber: repair.ticketNumber,
      resumeToken: nextResumeToken,
    };
  }

  const metadata = repairPickupPaymentClaims.create(
    {
      amountKobo,
      currency: quote.currency,
      merchantId: merchant.id,
      reference,
      repairId: repair.id,
    },
    secret
  );
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const callbackUrl = `${protocol}://${merchant.slug}.${rootDomain}/repair/status?ticket=${repair.ticketNumber}`;

  try {
    const payment = await initializeTransaction({
      amount: amountKobo,
      callback_url: callbackUrl,
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
      email: parsed.data.customerEmail,
      metadata,
      reference,
    });
    return {
      success: true,
      id: repair.id,
      ticketNumber: repair.ticketNumber,
      resumeToken: nextResumeToken,
      payment: {
        amount: quote.price,
        authorizationUrl: payment.authorization_url,
        reference,
      },
    };
  } catch (error) {
    console.error('Repair pickup payment initialization failed:', error);
    return {
      success: false,
      code: 'payment_initialization_failed',
      error:
        'Your repair request was saved, but payment could not start. Use your ticket to retry shortly.',
      id: repair.id,
      ticketNumber: repair.ticketNumber,
      resumeToken: nextResumeToken,
    };
  }
}
