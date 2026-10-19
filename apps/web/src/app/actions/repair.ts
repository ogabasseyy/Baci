'use server';

import { getMerchantByIdentifier } from '@/lib/cached-data';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { notifyRepairBooking } from '@/lib/repair-notifications';
import {
  type CreateRepairResult,
  createRepairBooking,
} from '@/lib/repairs/create-repair-core';
import { getRepairCenterAddress } from '@/lib/repairs/repair-center-address';
import {
  REPAIR_PICKUP_DECLARED_VALUE,
  REPAIR_PICKUP_PROVIDER,
} from '@/lib/repairs/repair-pickup-constants';
import { shippingService } from '@/lib/shipping';
import { isValidMerchantIdentifier } from '@/lib/validation';
import type { RepairBookingInput } from '@/lib/validations/repair';
import { repairPlaceDetailsSchema } from '@/schemas/repair-actions';

export type { CreateRepairResult };

interface PlaceDetails {
  streetNumber: string;
  route: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  formattedAddress: string;
}

export type ShippingCalculationResult = {
  isFree: boolean;
  price: number;
  formattedPrice: string;
  error?: string;
  message?: string;
};

// eslint-disable-next-line react-doctor/server-auth-actions -- public-by-design: anonymous repair booking; Zod-validated + identity/IP rate limited, write goes through the SECURITY DEFINER booking RPC
export async function createRepair(
  data: RepairBookingInput,
  merchantId: string
): Promise<CreateRepairResult> {
  if (!data || typeof data !== 'object') {
    return {
      success: false,
      code: 'validation_failed',
      error: 'Enter valid repair details.',
    };
  }

  if (data.serviceType === 'pickup') {
    return {
      success: false,
      code: 'unavailable',
      error: 'Courier pickup must be paid before booking.',
    };
  }

  // Shared core: app-layer rate limit + Zod validation + booking RPC (which
  // re-validates the merchant/active quote and snapshots the price server-side).
  const result = await createRepairBooking(data, merchantId);

  if (result.success) {
    // Notify the merchant (push) and email the customer a ticket
    // confirmation. Internally fail-safe: a notification/email error is
    // logged, never thrown, so it can't turn a successful booking into a
    // failed response.
    //
    // No revalidatePath here: booking a repair doesn't change anything a
    // storefront catalogue page (`/[slug]/repairs`, `/[slug]/repairs/[slug]`)
    // renders, and the previous `revalidatePath('/dashboard/repairs')` call
    // pointed at a dashboard bookings page that doesn't exist yet (Phase 4
    // owns that surface and its own revalidation).
    await notifyRepairBooking({
      customerEmail: data.customerEmail,
      customerName: data.customerName,
      deviceModel: data.deviceModel,
      deviceType: data.deviceType,
      merchantId,
      pickupAddress: data.pickupAddress ?? null,
      quoteId: data.quoteId ?? null,
      repairId: result.id,
      serviceType: data.serviceType,
      ticketNumber: result.ticketNumber,
    });
  }

  return result;
}

// eslint-disable-next-line react-doctor/server-auth-actions -- public-by-design: anonymous shipping quote; address completeness enforced by Zod + identity/IP rate limited
export async function calculateRepairShipping(
  place: PlaceDetails,
  merchantIdentifier: string
): Promise<ShippingCalculationResult> {
  // Rate limit first — this calls the GIGL quoting API and is
  // callable by anonymous storefront customers.
  const allowed = await ensureActionRateLimit('repair-shipping', {
    requests: 10,
    windowMs: 60_000,
  });
  if (!allowed) {
    return {
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Too many shipping estimates. Please try again shortly.',
    };
  }

  const parsedPlace = repairPlaceDetailsSchema.safeParse(place);
  if (!parsedPlace.success) {
    return {
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Invalid address details',
    };
  }

  const placeDetails = parsedPlace.data;

  // Server actions are public entry points, so the merchant is bound to the
  // storefront's PUBLIC identifier (slug/custom domain — what the page itself
  // resolves) instead of a caller-supplied raw merchant UUID. Unresolvable and
  // unpublished stores degrade IDENTICALLY to "no repair center configured",
  // so probing identifiers yields no signal about private repair settings.
  const dropOffOnly: ShippingCalculationResult = {
    isFree: false,
    price: 0,
    formattedPrice: 'Arranged after booking',
    message: 'Drop-off only — the store will contact you to arrange pickup.',
  };

  const merchant = isValidMerchantIdentifier(merchantIdentifier)
    ? await getMerchantByIdentifier(merchantIdentifier.toLowerCase())
    : null;
  if (!merchant?.is_published) {
    return dropOffOnly;
  }

  const repairCenter = await getRepairCenterAddress(merchant.id);
  if (!repairCenter) {
    return dropOffOnly;
  }

  try {
    // Calculate GIGL doorstep collection (customer -> repair center).
    const quotes = await shippingService.getProviderQuotes(
      REPAIR_PICKUP_PROVIDER,
      {
        sessionId: `repair-${Date.now()}`,
        shipmentType: 'domestic',
        items: [
          {
            name: 'Device for Repair',
            quantity: 1,
            weight: 1,
            value: REPAIR_PICKUP_DECLARED_VALUE,
            category: 'gadgets',
          },
        ],
        receiver: {
          name: repairCenter.name,
          phone: repairCenter.phone,
          email: repairCenter.email,
          address: repairCenter.address,
          city: repairCenter.city,
          state: repairCenter.state,
          country: repairCenter.country,
          countryCode: repairCenter.countryCode,
        },
        sender: {
          name: 'Customer',
          phone: '0000000000',
          address: placeDetails.formattedAddress,
          city: placeDetails.city || placeDetails.state,
          state: placeDetails.state,
          country: placeDetails.country || 'Nigeria',
          countryCode: 'NG',
        },
      }
    );

    if (!quotes || quotes.length === 0) {
      return {
        isFree: false,
        price: 0,
        formattedPrice: 'Calculated at confirmation',
        error: 'Could not fetch real-time rates',
      };
    }

    const validQuotes = quotes
      .filter((q) => q.price > 0 && !q.isStationPickup)
      .sort((a, b) => a.price - b.price);

    if (validQuotes.length === 0) {
      return {
        isFree: false,
        price: 0,
        formattedPrice: 'Calculated at confirmation',
        error: 'No valid rates found',
      };
    }

    const cheapest = validQuotes[0];

    return {
      isFree: false,
      price: cheapest.price,
      formattedPrice: `₦${cheapest.price.toLocaleString()}`,
      message: `Estimated pickup fee: ₦${cheapest.price.toLocaleString()}`,
    };
  } catch (error) {
    console.error('Error calculating shipping:', error);
    return {
      isFree: false,
      price: 0,
      formattedPrice: 'Calculated at confirmation',
      error: 'Failed to calculate shipping',
    };
  }
}
