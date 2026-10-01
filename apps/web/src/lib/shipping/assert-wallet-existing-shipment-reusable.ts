import type { BookOrderShipmentResult } from './book-order-shipment';
import { shouldReleaseBookingLock } from './order-shipment-booking-lock-errors';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

export function assertWalletExistingShipmentReusable(
  existing: BookOrderShipmentResult,
  quoteId: string
): void {
  if (existing.provider !== 'GIGL') {
    throw new OrderShipmentBookingError(
      'An existing shipment for this order uses a different shipping provider. Please review it before retrying.',
      409,
      'EXISTING_SHIPMENT_PROVIDER_MISMATCH'
    );
  }

  if (existing.quoteId && existing.quoteId !== quoteId) {
    throw new OrderShipmentBookingError(
      'An existing shipment for this order was booked with a different quote. Please review it before retrying.',
      409,
      'EXISTING_SHIPMENT_QUOTE_MISMATCH'
    );
  }
}

export async function assertWalletExistingShipmentReusableOrRelease(
  existing: BookOrderShipmentResult,
  quoteId: string,
  releaseLock?: () => Promise<void>
): Promise<void> {
  try {
    assertWalletExistingShipmentReusable(existing, quoteId);
  } catch (error) {
    if (releaseLock && shouldReleaseBookingLock(error)) {
      try {
        await releaseLock();
      } catch (releaseError) {
        console.error(
          'Failed to release shipment booking lock after mismatched existing shipment:',
          releaseError
        );
      }
    }
    throw error;
  }
}
