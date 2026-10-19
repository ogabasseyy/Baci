import 'server-only';
import type { PilotInventoryBinding } from '@/schemas/merchant-image-variant-pilot';
import {
  type ApprovedPilotTier,
  lookupPilotTiers,
  type PilotLabIndex,
} from './lab-index';
import { findPilotBinding } from './pilot-inventory';

// Request-time seam: after the existing trusted-host/publication/tenant
// guards, rendering performs only this guarded in-memory lookup. No image
// download, decode, encoding, or directory hashing runs on a shopper request.
// A null result keeps the mounted control path and is reported as not
// optimized; it never throws.
export function resolvePilotSlot(
  index: PilotLabIndex,
  bindings: readonly PilotInventoryBinding[],
  request: {
    baseUrl: string;
    merchantId: string;
    originalUrl: string;
    slotId: string;
  }
): {
  baseUrl: string;
  binding: PilotInventoryBinding;
  tiers: readonly ApprovedPilotTier[];
} | null {
  const binding = findPilotBinding(bindings, {
    merchantId: request.merchantId,
    originalUrl: request.originalUrl,
    slotId: request.slotId,
  });
  if (!binding) {
    return null;
  }
  const tiers = lookupPilotTiers(index, {
    assetId: binding.assetId,
    merchantId: binding.merchantId,
    role: binding.role,
    sourceSha256: binding.sourceSha256,
  });
  if (!tiers || tiers.length === 0) {
    return null;
  }
  return { baseUrl: request.baseUrl, binding, tiers };
}
