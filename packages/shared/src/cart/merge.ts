import { cartLineIdentity } from './line-identity';
import type {
  CartInputLine,
  CartItemIdentity,
  CartLine,
  CartLineAttachments,
  CartSnapshot,
} from './types';
import { SHARED_CART_MAX_LINES } from './types';

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
  | {
      code: 'merge_conflict';
      conflicts: CartMergeConflict[];
      ok: false;
      reason?: 'duplicate_identity';
    }
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
  resolutions: CartMergeResolution[] = [],
  options: { handoffReferences?: boolean } = {}
): PlanCartMergeResult {
  if (options.handoffReferences) {
    // Preview attachments are private. Submit bounded stored-line references
    // and let the locked server snapshots resolve lanes, quantities and picks.
    if (
      [existing, incoming].some(
        (cart) => cart.lines.length > SHARED_CART_MAX_LINES
      )
    )
      return {
        ok: false,
        code: 'too_many_lines',
        lineCount: existing.lines.length + incoming.lines.length,
      };
    const minimumLineCount = new Set(
      [...existing.lines, ...incoming.lines].map((line) =>
        cartLineIdentity(line.item)
      )
    ).size;
    if (minimumLineCount > SHARED_CART_MAX_LINES) {
      return { ok: false, code: 'too_many_lines', lineCount: minimumLineCount };
    }
    const refs = new Map<string, CartInputLine>();
    for (const line of [...existing.lines, ...incoming.lines]) {
      refs.set(line.id, {
        sourceLineId: line.id,
        item: line.item,
        quantity: line.quantity,
        ...(line.hasAssurance ? { hasAssurance: true } : {}),
      });
    }
    return { ok: true, lines: [...refs.values()] };
  }
  // A cart may lawfully hold a regular line plus attachment-specific siblings.
  // Keep legacy one-to-one conflict choices, but do not collapse sibling lanes.
  const siblingBases = new Set<string>();
  for (const snapshot of [existing, incoming]) {
    const seenBases = new Set<string>();
    for (const line of snapshot.lines) {
      const base = cartLineIdentity(line.item);
      if (seenBases.has(base)) siblingBases.add(base);
      seenBases.add(base);
    }
  }
  const keyOf = (line: CartLine): string => {
    const base = cartLineIdentity(line.item);
    if (!siblingBases.has(base)) return base;
    return JSON.stringify([
      base,
      line.voucherToken ?? null,
      line.voucherAwardId ?? null,
      line.negotiatedUnitPriceMinor ?? null,
      line.negotiationStatus ?? null,
    ]);
  };
  for (const snapshot of [existing, incoming]) {
    const seen = new Map<string, CartLine>();
    for (const line of snapshot.lines) {
      const key = keyOf(line);
      const previous = seen.get(key);
      if (previous)
        return {
          ok: false,
          code: 'merge_conflict',
          reason: 'duplicate_identity',
          conflicts: [
            {
              item: line.item,
              existing: {
                ...attachmentsOf(previous),
                quantity: previous.quantity,
              },
              incoming: { ...attachmentsOf(line), quantity: line.quantity },
            },
          ],
        };
      seen.set(key, line);
    }
  }
  const existingByKey = new Map<string, CartLine>();
  for (const line of existing.lines) {
    existingByKey.set(keyOf(line), line);
  }
  const incomingByKey = new Map<string, CartLine>();
  for (const line of incoming.lines) {
    incomingByKey.set(keyOf(line), line);
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
        ...(source.hasAssurance ? { hasAssurance: true } : null),
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
        ...(existingLine.hasAssurance || incomingLine.hasAssurance
          ? { hasAssurance: true }
          : null),
        item: existingLine.item,
        quantity: hasVoucher(existingAttachments)
          ? 1
          : Math.max(existingLine.quantity, incomingLine.quantity),
      });
      continue;
    }
    // Sibling lanes key by their attachment lane; a shopper resolution
    // names the base item, so fall back to the base identity when the
    // augmented lane key has no direct entry.
    const keep =
      resolutionByKey.get(key) ??
      resolutionByKey.get(cartLineIdentity(existingLine.item));
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
      ...((keep === 'incoming' ? incomingLine : existingLine).hasAssurance
        ? { hasAssurance: true }
        : null),
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
