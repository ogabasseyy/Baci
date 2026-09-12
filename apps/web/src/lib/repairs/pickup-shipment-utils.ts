import type { ShipmentItem, ShippingAddress } from '@/lib/shipping/types';
import { REPAIR_PICKUP_DECLARED_VALUE } from './repair-pickup-constants';
import { resolveRepairPickupLocation } from './resolve-repair-pickup-location';

/**
 * Minimal repair fields needed to build a courier pickup shipment
 * (customer = sender, merchant repair center = receiver).
 */
export interface RepairPickupSource {
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  device_type: string | null;
  device_model: string | null;
  pickup_address: string | null;
  quoted_price: number | string | null;
}

/** Why a courier pickup could not be booked automatically. */
export type PickupFailureReason =
  | 'not_found'
  | 'lookup_failed'
  | 'payment_required'
  | 'terminal_status'
  | 'already_booked'
  | 'booking_in_progress'
  | 'missing_pickup_address'
  | 'repair_center_unconfigured'
  | 'gigl_unavailable'
  | 'quote_increased'
  | 'booking_failed'
  | 'provider_rejected'
  | 'shipment_save_failed';

export interface BookRepairPickupSuccess {
  ok: true;
  trackingNumber: string;
  carrierName: string;
  shipmentId: string;
  pickupScheduledAt: string | null;
}

export interface BookRepairPickupFailure {
  ok: false;
  reason: PickupFailureReason;
  message: string;
  /** Whether the "mark pickup arranged manually" fallback should be offered. */
  canRetryManually: boolean;
}

export type BookRepairPickupResult =
  | BookRepairPickupSuccess
  | BookRepairPickupFailure;

const FAILURE_COPY: Record<
  PickupFailureReason,
  { message: string; canRetryManually: boolean }
> = {
  not_found: {
    message: 'Repair booking not found.',
    canRetryManually: false,
  },
  lookup_failed: {
    message:
      'Could not load this repair booking right now. Payment is safe — please retry shortly.',
    canRetryManually: false,
  },
  payment_required: {
    message: 'The customer must pay the pickup fee before courier booking.',
    canRetryManually: false,
  },
  terminal_status: {
    message:
      'This repair is completed, cancelled, or rejected — a courier pickup cannot be arranged.',
    canRetryManually: false,
  },
  already_booked: {
    message: 'A courier pickup has already been arranged for this booking.',
    canRetryManually: false,
  },
  booking_in_progress: {
    message:
      'A courier pickup is already being arranged for this booking. Please wait a moment before retrying.',
    canRetryManually: false,
  },
  missing_pickup_address: {
    message:
      'This booking has no pickup address. Ask the customer for one or mark pickup arranged manually.',
    canRetryManually: true,
  },
  repair_center_unconfigured: {
    message:
      'Add your repair-center pickup address in settings before arranging courier pickup.',
    canRetryManually: true,
  },
  gigl_unavailable: {
    message:
      "GIG Logistics pickup isn't available for this address right now. Ask the customer to drop the device at a GIGL service centre or arrange pickup manually.",
    canRetryManually: true,
  },
  quote_increased: {
    message:
      'The current GIG Logistics pickup rate is higher than the amount paid. Please review the new rate before booking.',
    canRetryManually: true,
  },
  booking_failed: {
    message:
      'GIG Logistics could not confirm the pickup. Check the GIGL account balance and booking details, or arrange pickup manually.',
    canRetryManually: true,
  },
  provider_rejected: {
    message:
      'GIG Logistics rejected this pickup request. Review the booking details or arrange pickup manually.',
    canRetryManually: true,
  },
  shipment_save_failed: {
    message:
      'The courier was booked but the shipment could not be saved. Please review before retrying.',
    canRetryManually: false,
  },
};

export function pickupFailure(
  reason: PickupFailureReason
): BookRepairPickupFailure {
  const copy = FAILURE_COPY[reason];
  return {
    ok: false,
    reason,
    message: copy.message,
    canRetryManually: copy.canRetryManually,
  };
}

/**
 * Builds the shipment sender from the customer's pickup address (free-text),
 * deriving city/state with the Nigerian repair-location resolver. Returns null when the
 * booking has no pickup address to collect from.
 */
export function buildPickupSender(
  repair: RepairPickupSource
): ShippingAddress | null {
  const pickupAddress = repair.pickup_address?.trim();
  if (!pickupAddress) {
    return null;
  }

  const location = resolveRepairPickupLocation(pickupAddress);
  return {
    name: repair.customer_name?.trim() || 'Customer',
    phone: repair.customer_phone?.trim() || '',
    email: repair.customer_email?.trim() || undefined,
    address: location.address,
    city: location.city,
    state: location.state,
    country: 'Nigeria',
    countryCode: 'NG',
  };
}

export function buildPickupItems(repair: RepairPickupSource): ShipmentItem[] {
  const label =
    `${repair.device_type ?? ''} ${repair.device_model ?? ''}`.trim();
  const name = label || 'Device for repair';
  return [
    {
      name,
      description: name,
      quantity: 1,
      weight: 1,
      // Ignore catalog quoted_price so estimate → pay → book stay rate-aligned.
      value: REPAIR_PICKUP_DECLARED_VALUE,
    },
  ];
}
