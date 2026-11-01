import type {
  CartErrorCode,
  CartInputLine,
  CartItemIdentity,
  CartSnapshot,
} from '@baci/shared/cart';

import type { SupabaseClient } from '@supabase/supabase-js';
import { redactPreviewSnapshot } from './handoff-preview';
import {
  type HandoffChoice,
  type HandoffDestinationType,
  hashHandoffToken,
  isRecord,
} from './handoff-token';
import { buildCartSnapshot } from './pricing';
import { CartRepositoryError, parseRawMutationResult } from './repository';

export interface HandoffConflictView {
  item: CartItemIdentity;
  existing: Record<string, unknown>;
  incoming: Record<string, unknown>;
}

export type RedeemHandoffResult =
  | {
      ok: true;
      /** Null when keep-existing runs without a destination cart. */
      cart: CartSnapshot | null;
      grantId: string | null;
      /** Expiry of the selected grant, when the RPC surfaces it. */
      grantExpiresAt: string | null;
      choice: HandoffChoice;
      replayed: boolean;
      warnings: { code: string; message: string }[];
    }
  | {
      ok: false;
      code: CartErrorCode;
      cart?: CartSnapshot;
      conflicts?: HandoffConflictView[];
      incomingVersion?: number | null;
      destVersion?: number | null;
    };

export interface RedeemHandoffInput {
  token: string;
  handoffId: string;
  attemptId: string;
  choice: HandoffChoice;
  caller: HandoffDestinationType;
  destCartId?: string;
  expectedIncomingVersion?: number;
  expectedDestVersion?: number;
  lines?: CartInputLine[];
  resolutions?: { item: CartItemIdentity; keep: 'incoming' | 'existing' }[];
}

/**
 * Allowlist one side of a merge conflict for the route response. The
 * SQL wrapper already strips credential-bearing fields, but the TS
 * layer must not trust that alone: a future RPC replacement that
 * forgets the wrapper would otherwise leak transferable voucher
 * credentials and negotiated terms to the destination device. Only
 * quantity and the presence flags the UI needs survive.
 */
function redactConflictSide(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const side: Record<string, unknown> = {};
  if (typeof value.quantity === 'number') side.quantity = value.quantity;
  side.hasVoucher = Boolean(
    value.hasVoucher || value.voucherToken || value.voucherAwardId
  );
  side.hasNegotiation = Boolean(
    value.hasNegotiation ||
      typeof value.negotiatedUnitPriceMinor === 'number' ||
      (typeof value.negotiationStatus === 'string' &&
        value.negotiationStatus !== 'none')
  );
  if (value.hasAssurance === true) side.hasAssurance = true;
  return side;
}

export function parseConflicts(
  value: unknown
): HandoffConflictView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const conflicts: HandoffConflictView[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isRecord(entry.item)) return undefined;
    if (typeof entry.item.productId !== 'string') return undefined;
    const item: CartItemIdentity = { productId: entry.item.productId };
    if (typeof entry.item.variantId === 'string') {
      item.variantId = entry.item.variantId;
    }
    if (typeof entry.item.offerId === 'string' && entry.item.offerId.trim()) {
      item.offerId = entry.item.offerId;
    }
    if (
      entry.item.condition === 'new' ||
      entry.item.condition === 'used' ||
      entry.item.condition === 'open_box' ||
      entry.item.condition === 'refurbished'
    ) {
      item.condition = entry.item.condition;
    }
    if (isRecord(entry.item.options)) {
      const options: Record<string, string> = {};
      for (const [key, option] of Object.entries(entry.item.options)) {
        if (typeof option === 'string') options[key] = option;
      }
      item.options = options;
    }
    conflicts.push({
      existing: redactConflictSide(entry.existing),
      incoming: redactConflictSide(entry.incoming),
      item,
    });
  }
  return conflicts;
}

export function parseVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * Redeems a handoff grant for a destination attempt. The token is
 * hashed at the boundary: RPC arguments, receipts and logs see only
 * the hash. Successful outcomes price the resulting snapshot.
 */
export async function redeemCartHandoff(
  client: SupabaseClient,
  input: RedeemHandoffInput
): Promise<RedeemHandoffResult> {
  const response = await client.rpc('commerce_cart_redeem_handoff', {
    p_attempt_id: input.attemptId,
    p_caller: input.caller,
    p_choice: input.choice,
    p_dest_cart_id: input.destCartId ?? null,
    p_expected_dest_version: input.expectedDestVersion ?? null,
    p_expected_incoming_version: input.expectedIncomingVersion ?? null,
    p_handoff_id: input.handoffId,
    p_lines: input.lines ?? null,
    p_resolutions: input.resolutions ?? null,
    p_token_hash: hashHandoffToken(input.token),
  });
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_redeem_handoff failed'
    );
  }
  const data = (response.data ?? {}) as Record<string, unknown>;
  if (data.ok === true && data.state == null) {
    const grantId =
      typeof data.grantId === 'string' && data.grantId ? data.grantId : null;
    return {
      cart: null,
      choice: input.choice,
      grantId,
      grantExpiresAt:
        typeof data.grantExpiresAt === 'string' &&
        Number.isFinite(Date.parse(data.grantExpiresAt))
          ? data.grantExpiresAt
          : null,
      ok: true,
      replayed: data.replayed === true,
      warnings: [],
    };
  }
  const parsed = parseRawMutationResult(response.data);
  if (parsed.ok) {
    const priced = parsed.state ? buildCartSnapshot(parsed.state) : null;
    return {
      cart: priced ? priced.snapshot : null,
      choice: input.choice,
      grantId: parsed.grantId,
      grantExpiresAt: parsed.grantExpiresAt,
      ok: true,
      replayed: parsed.replayed,
      warnings: priced ? priced.warnings : [],
    };
  }
  const code = parsed.code ?? 'temporarily_unavailable';
  const priced = parsed.state ? buildCartSnapshot(parsed.state) : null;
  return {
    // Failure states can be the not-yet-redeemed incoming cart: its
    // voucher credentials never leave in an error response, matching
    // the conflict redaction below.
    ...(priced ? { cart: redactPreviewSnapshot(priced.snapshot) } : null),
    code,
    conflicts:
      code === 'merge_conflict' ? parseConflicts(data.conflicts) : undefined,
    destVersion: parseVersion(data.destVersion),
    incomingVersion: parseVersion(data.incomingVersion),
    ok: false,
  };
}
