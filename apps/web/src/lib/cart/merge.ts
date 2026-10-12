import type {
  CartInputLine,
  CartItemIdentity,
  CartLine,
  CartLineAttachments,
  CartSnapshot,
} from '@baci/shared/cart';
import { cartLineIdentity, SHARED_CART_MAX_LINES } from '@baci/shared/cart';

export interface CartMergeResolution {
  item: CartItemIdentity;
  keep: 'incoming' | 'existing';
}

export interface CartMergeConflict {
  item: CartItemIdentity;
  existing: CartLineAttachments & { quantity: number };
  incoming: CartLineAttachments & { quantity: number };
}

export type PlanCartMergeResult =
  | { lines: CartInputLine[]; ok: true }
  | { code: 'merge_conflict'; conflicts: CartMergeConflict[]; ok: false }
  | { code: 'too_many_lines'; lineCount: number; ok: false };

function attachmentsOf(line: CartLine): CartLineAttachments {
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

function attachmentsEqual(
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

function hasVoucher(attachments: CartLineAttachments): boolean {
  return Boolean(attachments.voucherToken ?? attachments.voucherAwardId);
}

/**
 * Plans an explicit merge of an incoming handoff cart into an existing
 * destination cart. Same-line quantities use max (so repeated import
 * never increments) and conflicting voucher/negotiation contexts
 * require a per-line choice. The redemption RPC re-enforces these
 * rules transactionally; this plan drives the continuation UI and the
 * submitted line set.
 */
export function planCartMerge(
  existing: CartSnapshot,
  incoming: CartSnapshot,
  resolutions: CartMergeResolution[] = []
): PlanCartMergeResult {
  const existingByKey = new Map<string, CartLine>();
  for (const line of existing.lines) {
    existingByKey.set(cartLineIdentity(line.item), line);
  }
  const incomingByKey = new Map<string, CartLine>();
  for (const line of incoming.lines) {
    incomingByKey.set(cartLineIdentity(line.item), line);
  }
  const resolutionByKey = new Map<string, CartMergeResolution['keep']>();
  for (const resolution of resolutions) {
    resolutionByKey.set(cartLineIdentity(resolution.item), resolution.keep);
  }

  const keys = new Set([...existingByKey.keys(), ...incomingByKey.keys()]);
  if (keys.size > SHARED_CART_MAX_LINES) {
    return { code: 'too_many_lines', lineCount: keys.size, ok: false };
  }

  const lines: CartInputLine[] = [];
  const conflicts: CartMergeConflict[] = [];
  for (const key of keys) {
    const existingLine = existingByKey.get(key);
    const incomingLine = incomingByKey.get(key);
    if (!existingLine || !incomingLine) {
      const source = (existingLine ?? incomingLine) as CartLine;
      const attachments = attachmentsOf(source);
      lines.push({
        ...attachments,
        item: source.item,
        quantity: hasVoucher(attachments) ? 1 : source.quantity,
      });
      continue;
    }
    const existingAttachments = attachmentsOf(existingLine);
    const incomingAttachments = attachmentsOf(incomingLine);
    if (attachmentsEqual(existingAttachments, incomingAttachments)) {
      lines.push({
        ...existingAttachments,
        item: existingLine.item,
        quantity: hasVoucher(existingAttachments)
          ? 1
          : Math.max(existingLine.quantity, incomingLine.quantity),
      });
      continue;
    }
    const keep = resolutionByKey.get(key);
    if (!keep) {
      conflicts.push({
        existing: {
          ...existingAttachments,
          quantity: existingLine.quantity,
        },
        incoming: {
          ...incomingAttachments,
          quantity: incomingLine.quantity,
        },
        item: existingLine.item,
      });
      continue;
    }
    const chosen =
      keep === 'incoming' ? incomingAttachments : existingAttachments;
    lines.push({
      ...chosen,
      item: existingLine.item,
      quantity: hasVoucher(chosen)
        ? 1
        : Math.max(existingLine.quantity, incomingLine.quantity),
    });
  }

  if (conflicts.length > 0) {
    return { code: 'merge_conflict', conflicts, ok: false };
  }
  return { lines, ok: true };
}
