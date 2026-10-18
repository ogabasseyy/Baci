import { cartLineIdentity } from './line-identity';
import {
  attachmentsEqual,
  attachmentsOf,
  conflictAttachmentsOf,
  hasVoucher,
  planHandoffReferenceMerge,
} from './merge-helpers';
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
    return planHandoffReferenceMerge(existing, incoming);
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
  // Two snapshots can each hold a single, different award for one
  // product without either registering a within-snapshot sibling;
  // those are distinct entitlements and must not collapse into one
  // conflicted lane. A lone award meeting a regular lane keeps the
  // legacy conflict choice.
  const awardIdsByBase = new Map<string, Set<string>>();
  for (const snapshot of [existing, incoming]) {
    for (const line of snapshot.lines) {
      if (!line.voucherAwardId) continue;
      const base = cartLineIdentity(line.item);
      const awards = awardIdsByBase.get(base) ?? new Set<string>();
      awards.add(line.voucherAwardId);
      awardIdsByBase.set(base, awards);
    }
  }
  const keyOf = (line: CartLine): string => {
    const base = cartLineIdentity(line.item);
    const distinctAwards = (awardIdsByBase.get(base)?.size ?? 0) > 1;
    if (!siblingBases.has(base) && !distinctAwards) return base;
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
          ...conflictAttachmentsOf(existingLine),
          quantity: existingLine.quantity,
        },
        incoming: {
          ...conflictAttachmentsOf(incomingLine),
          quantity: incomingLine.quantity,
        },
        item: existingLine.item,
      });
      continue;
    }
    const chosen =
      keep === 'incoming' ? incomingAttachments : existingAttachments;
    const chosenLine = keep === 'incoming' ? incomingLine : existingLine;
    lines.push({
      ...chosen,
      ...(chosenLine.hasAssurance ? { hasAssurance: true } : null),
      item: existingLine.item,
      // The shopper chose this side as presented, quantity included;
      // the max rule only applies to the equal-attachments branch.
      quantity: hasVoucher(chosen) ? 1 : chosenLine.quantity,
    });
  }

  if (conflicts.length > 0) {
    return { code: 'merge_conflict', conflicts, ok: false };
  }
  return { lines, ok: true };
}
