import {
  STOREFRONT_PDP_PREFLIGHT_RPC,
  storefrontPdpPreflightRowSchema,
} from '@/schemas/storefront-preflight-rpc';

export const PDP_PUBLISHED_ACTIVE_TTL_MS = 60_000;

export interface StorefrontPreflightMemoWriteDecision {
  shouldMemoize: boolean;
  ttlMs?: number;
}

/**
 * Selects whether an RPC row is safe to memoize and for how long.
 * Published active PDP rows stay memoized for 60s to bound repeat PDP hits;
 * non-active/negative/alias PDP rows retain the short default memo TTL, and
 * schema-invalid PDP rows are never memoized.
 */
export function getStorefrontPreflightMemoWriteDecision(
  fn: string,
  row: unknown
): StorefrontPreflightMemoWriteDecision {
  if (fn !== STOREFRONT_PDP_PREFLIGHT_RPC) {
    return { shouldMemoize: true };
  }
  const parsed = storefrontPdpPreflightRowSchema.safeParse(row);
  if (!parsed.success) {
    return { shouldMemoize: false };
  }
  if (
    parsed.data.present &&
    parsed.data.storefront_status === 'published' &&
    parsed.data.match_kind === 'active'
  ) {
    return { shouldMemoize: true, ttlMs: PDP_PUBLISHED_ACTIVE_TTL_MS };
  }
  return { shouldMemoize: true };
}
