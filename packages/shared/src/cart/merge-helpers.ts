import { cartLineIdentity } from './line-identity';
import type { PlanCartMergeResult } from './merge';
import type {
  CartInputLine,
  CartLine,
  CartLineAttachments,
  CartSnapshot,
} from './types';
import { SHARED_CART_MAX_LINES } from './types';

export function attachmentsOf(line: CartLine): CartLineAttachments {
  return {
    ...(line.voucherToken ? { voucherToken: line.voucherToken } : null),
    ...(line.voucherAwardId ? { voucherAwardId: line.voucherAwardId } : null),
    ...(line.negotiatedUnitPriceMinor !== undefined
      ? { negotiatedUnitPriceMinor: line.negotiatedUnitPriceMinor }
      : null),
    ...(line.negotiationStatus
      ? { negotiationStatus: line.negotiationStatus }
      : null),
  };
}

// Conflict payloads cross persistence/telemetry boundaries: the raw
// voucher token is a spendable credential and never belongs there.
// Resolutions re-read the chosen snapshot lane, so redaction here
// does not affect which line a resolution applies.
export function conflictAttachmentsOf(line: CartLine): CartLineAttachments {
  const { voucherToken: _redacted, ...rest } = attachmentsOf(line);
  return rest;
}

export function attachmentsEqual(
  left: CartLineAttachments,
  right: CartLineAttachments
): boolean {
  return (
    (left.voucherToken ?? null) === (right.voucherToken ?? null) &&
    (left.voucherAwardId ?? null) === (right.voucherAwardId ?? null) &&
    (left.negotiatedUnitPriceMinor ?? null) ===
      (right.negotiatedUnitPriceMinor ?? null) &&
    (left.negotiationStatus ?? null) === (right.negotiationStatus ?? null)
  );
}

export function hasVoucher(attachments: CartLineAttachments): boolean {
  // Only a complete token-and-award pair is voucher-backed; a partial
  // pair is an ordinary priced line and keeps its stored quantity.
  return Boolean(attachments.voucherToken && attachments.voucherAwardId);
}

export function planHandoffReferenceMerge(
  existing: CartSnapshot,
  incoming: CartSnapshot
): PlanCartMergeResult {
  // Preview attachments are private. Submit bounded stored-line references
  // and let the locked server snapshots resolve lanes, quantities and picks.
  if (
    [existing, incoming].some(
      (cart) => cart.lines.length > SHARED_CART_MAX_LINES
    )
  ) {
    return {
      ok: false,
      code: 'too_many_lines',
      lineCount: existing.lines.length + incoming.lines.length,
    };
  }
  const minimumLineCount = new Set(
    [...existing.lines, ...incoming.lines].map((line) =>
      cartLineIdentity(line.item)
    )
  ).size;
  if (minimumLineCount > SHARED_CART_MAX_LINES) {
    return { ok: false, code: 'too_many_lines', lineCount: minimumLineCount };
  }
  const refs = new Map<string, CartInputLine>();
  const refLines = new Map<string, CartLine>();
  for (const line of [...existing.lines, ...incoming.lines]) {
    const previous = refLines.get(line.id);
    if (previous) {
      // The same stored line presented twice (same cart on both
      // sides, a replayed preview) coalesces; a repeated id with
      // different content is a duplicate identity, never a silent
      // overwrite.
      if (
        cartLineIdentity(previous.item) !== cartLineIdentity(line.item) ||
        previous.quantity !== line.quantity ||
        Boolean(previous.hasAssurance) !== Boolean(line.hasAssurance) ||
        !attachmentsEqual(attachmentsOf(previous), attachmentsOf(line))
      ) {
        return {
          ok: false,
          code: 'merge_conflict',
          reason: 'duplicate_identity',
          conflicts: [
            {
              item: line.item,
              existing: {
                ...conflictAttachmentsOf(previous),
                quantity: previous.quantity,
              },
              incoming: {
                ...conflictAttachmentsOf(line),
                quantity: line.quantity,
              },
            },
          ],
        };
      }
      continue;
    }
    refLines.set(line.id, line);
    refs.set(line.id, {
      sourceLineId: line.id,
      item: line.item,
      quantity: line.quantity,
      ...(line.hasAssurance ? { hasAssurance: true } : {}),
    });
  }
  return { ok: true, lines: [...refs.values()] };
}
