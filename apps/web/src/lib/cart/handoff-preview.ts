import type { CartErrorCode, CartSnapshot } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashHandoffToken, isRecord } from './handoff-token';
import { buildCartSnapshot } from './pricing';
import { CartRepositoryError, parseRawMutationResult } from './repository';
import { ERROR_CODES } from './repository-envelope';

/**
 * The preview is unauthenticated, so credential-bearing and
 * shopper-private line fields never leave with it — even if the preview
 * RPC regresses, the route response cannot carry a quiz voucher token,
 * a voucher award reference or negotiated terms.
 */
export function redactPreviewSnapshot(snapshot: CartSnapshot): CartSnapshot {
  return {
    ...snapshot,
    lines: snapshot.lines.map((line) => ({
      ...line,
      negotiatedUnitPriceMinor: undefined,
      negotiationStatus: undefined,
      voucherAwardId: undefined,
      voucherToken: undefined,
    })),
  };
}

/**
 * Resolves only the merchant id for a handoff so the route can enforce
 * the merchant-scoped preview quota before the expensive preview RPC
 * assembles a snapshot. Token-gated like the preview itself: an id
 * without its pairing token resolves nothing. Returns null for unknown
 * handoffs and for token mismatches alike.
 */
export async function rpcHandoffMerchantId(
  client: SupabaseClient,
  handoffId: string,
  token: string
): Promise<string | null> {
  const response = await client.rpc('commerce_cart_handoff_merchant', {
    p_handoff_id: handoffId,
    p_token_hash: hashHandoffToken(token),
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_handoff_merchant failed'
    );
  }
  return typeof response.data === 'string' ? response.data : null;
}

export type PreviewHandoffResult =
  | {
      ok: true;
      status: 'pending' | 'consumed' | 'expired';
      merchant: { id: string; slug: string | null } | null;
      snapshot: CartSnapshot | null;
      expiresAt: string | null;
      warnings: { code: string; message: string }[];
    }
  | { code: CartErrorCode; ok: false };

/**
 * Loads the continuation preview. The public handoff id locates the
 * grant; only the pairing token hash bound to it authorizes disclosure.
 */
export async function rpcPreviewHandoff(
  client: SupabaseClient,
  handoffId: string,
  token: string
): Promise<PreviewHandoffResult> {
  const response = await client.rpc('commerce_cart_preview_handoff', {
    p_handoff_id: handoffId,
    p_token_hash: hashHandoffToken(token),
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff failed'
    );
  }
  const data = response.data as Record<string, unknown> | null;
  if (!isRecord(data)) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff returned malformed data'
    );
  }
  if (data.ok !== true) {
    const code = data.code;
    return {
      code:
        typeof code === 'string' && ERROR_CODES.has(code)
          ? (code as CartErrorCode)
          : 'temporarily_unavailable',
      ok: false,
    };
  }
  const status = data.status;
  if (status !== 'pending' && status !== 'consumed' && status !== 'expired') {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff returned an unknown status'
    );
  }
  const merchant = data.merchant;
  if (status !== 'pending') {
    return {
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
      merchant: null,
      ok: true,
      snapshot: null,
      status,
      warnings: [],
    };
  }
  const parsed = parseRawMutationResult({
    code: null,
    currentVersion: null,
    grantId: null,
    ok: true,
    replayed: false,
    state: data.snapshot ?? null,
  });
  if (!parsed.state) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_preview_handoff omitted the snapshot'
    );
  }
  const priced = buildCartSnapshot(parsed.state);
  return {
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : null,
    merchant:
      isRecord(merchant) && typeof merchant.id === 'string'
        ? {
            id: merchant.id,
            slug: typeof merchant.slug === 'string' ? merchant.slug : null,
          }
        : null,
    ok: true,
    snapshot: redactPreviewSnapshot(priced.snapshot),
    status,
    warnings: priced.warnings,
  };
}
