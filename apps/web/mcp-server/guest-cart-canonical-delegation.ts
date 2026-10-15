import { guestCartLineSchema } from '../src/schemas/guest-cart-line';
import type { GuestCanonicalBridge } from './guest-cart-canonical-bridge';
import {
  GuestCartBridgePendingError,
  GuestCartCanonicalError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import type { GuestCartLine, GuestCartLineInput } from './guest-cart-store';

type CartResult = Awaited<ReturnType<GuestCanonicalBridge['update']>> & {
  cart_emptied?: boolean;
};

/** Bridge transport and recoverable first-migration failures share one health contract. */
export async function updateGuestCartWithCanonical({
  token,
  line,
  validate,
  canonical,
  recordStorageError,
  updateLegacy,
}: {
  token: string | undefined;
  line: GuestCartLineInput;
  validate: (items: GuestCartLine[]) => Promise<void>;
  canonical: GuestCanonicalBridge | null;
  recordStorageError: (code: string | null) => void;
  updateLegacy: (line: GuestCartLineInput) => Promise<CartResult>;
}): Promise<CartResult> {
  if (!token && line.quantity === 0)
    throw new Error('A guest cart is required');
  // UUID text is case-insensitive: canonicalize before persisting,
  // comparing, and enforcing per-product uniqueness.
  const normalizedLine = {
    ...line,
    product_id:
      typeof line.product_id === 'string'
        ? line.product_id.toLowerCase()
        : line.product_id,
  };
  if (!token) {
    // A new cart starts empty, so its merged lines are known without
    // I/O: validate before any write so a slow catalog lookup never
    // costs anything. Accepted window: the catalog may change between
    // this check and the persisted write; the website re-checks price
    // and stock at transfer, so a line that went stale is dropped there.
    await validate([guestCartLineSchema.parse(normalizedLine)]);
  }
  // Record runtime storage failures for /health (cleared by the next
  // success) so an outage cannot keep the probe green. Only the
  // token-free code is recorded, never the message.
  try {
    if (token && canonical) {
      if (normalizedLine.quantity > 0)
        await validate([guestCartLineSchema.parse(normalizedLine)]);
      const result = await canonical.update(token, normalizedLine);
      recordStorageError(null);
      return result;
    }
    const result = await updateLegacy(normalizedLine);
    recordStorageError(null);
    if (canonical) {
      try {
        return await canonical.update(result.cart_token, normalizedLine);
      } catch (error) {
        if (error instanceof GuestCartStorageUnavailableError)
          recordStorageError(error.code ?? 'bridge_unavailable');
        if (
          error instanceof GuestCartCanonicalError &&
          error.code === 'temporarily_unavailable'
        )
          recordStorageError('bridge_unavailable');
        throw new GuestCartBridgePendingError(result.cart_token);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof GuestCartStorageUnavailableError)
      recordStorageError(error.code ?? 'unknown');
    else if (
      error instanceof GuestCartCanonicalError &&
      error.code === 'temporarily_unavailable'
    )
      recordStorageError('bridge_unavailable');
    throw error;
  }
}

export async function readGuestCartMigration(
  read: () => Promise<{ migrated_to_cart_id: unknown }[]>
) {
  const rows = await read();
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return typeof row?.migrated_to_cart_id === 'string'
    ? row.migrated_to_cart_id
    : null;
}
