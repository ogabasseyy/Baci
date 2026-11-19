import {
  clearCartDeviceSessionActive,
  markCartDeviceSessionActive,
} from './cart-device-session-markers';
import { writeCartSessionHint } from './cart-session-hint';

/**
 * Synchronizes the merchant-scoped cart hint cookie and device-session
 * active marker after a snapshot adoption or non-retryable fetch outcome.
 */
export function syncCartSessionMarkers(params: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  active: boolean;
  preserveDeviceMarker?: boolean;
}): void {
  writeCartSessionHint(params.merchantId, params.active ? '1' : '0');
  if (!params.merchantSlug) return;
  if (params.active) {
    markCartDeviceSessionActive(params.merchantSlug);
  } else if (!params.preserveDeviceMarker) {
    clearCartDeviceSessionActive(params.merchantSlug);
  }
}
