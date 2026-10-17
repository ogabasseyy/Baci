import {
  type CartInputLine,
  type CartLine,
  type CartSnapshot,
  cartLineIdentity,
  SHARED_CART_MAX_LINES,
  SHARED_CART_MAX_QUANTITY_PER_LINE,
} from '@baci/shared/cart';

import { type CartMergeConflict, planCartMerge } from '@/lib/cart/merge';

import type { CartItem } from './cart-types';
import { cartItemToIdentity } from './shared-cart-display';

/**
 * Converts a display line to a server input line. Quantities clamp to
 * the canonical per-line bound, voucher lines pin to one, and a
 * negotiated price without a settled status is dropped rather than
 * sent as an authoritative-looking half attachment.
 */
export function displayLineToInputLine(item: CartItem): CartInputLine {
  const line: CartInputLine = {
    item: cartItemToIdentity(item),
    quantity: Math.min(
      SHARED_CART_MAX_QUANTITY_PER_LINE,
      Math.max(1, Math.round(item.quantity))
    ),
  };
  if (item.hasAssurance !== undefined) line.hasAssurance = item.hasAssurance;
  if (item.quizVoucherToken) line.voucherToken = item.quizVoucherToken;
  if (item.quizAwardId) line.voucherAwardId = item.quizAwardId;
  if (line.voucherToken && line.voucherAwardId) line.quantity = 1;
  if (
    item.negotiationStatus === 'pending' ||
    item.negotiationStatus === 'accepted' ||
    item.negotiationStatus === 'rejected'
  ) {
    line.negotiationStatus = item.negotiationStatus;
    if (
      typeof item.negotiatedPrice === 'number' &&
      Number.isFinite(item.negotiatedPrice) &&
      item.negotiatedPrice >= 0
    ) {
      line.negotiatedUnitPriceMinor = Math.round(item.negotiatedPrice * 100);
    }
  }
  return line;
}

export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type PlannedLegacyImport =
  | { kind: 'nothing' }
  | { kind: 'blocked'; code: 'too_many_lines'; lineCount: number }
  | {
      kind: 'create';
      lines: CartInputLine[];
      operationId: string;
      warnings: string[];
    }
  | {
      kind: 'commands';
      replacement?: {
        lines: CartInputLine[];
        operationId: string;
        expectedVersion: number;
      };
      adds: { line: CartInputLine; operationId: string }[];
      sets: { lineId: string; quantity: number }[];
      assurances: { lineId: string; hasAssurance: boolean }[];
      warnings: string[];
    }
  | { kind: 'conflicts'; conflicts: CartMergeConflict[] };

export function inputLinesOf(items: CartItem[]): {
  lines: CartInputLine[];
  clamped: boolean;
} {
  let clamped = false;
  const lines = items.map((item) => {
    const line = displayLineToInputLine(item);
    if (line.quantity !== Math.max(1, Math.round(item.quantity))) {
      clamped = true;
    }
    return line;
  });
  return { clamped, lines };
}

export function syntheticIncoming(lines: CartInputLine[]): CartSnapshot {
  return {
    cartId: 'import-incoming',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(0).toISOString(),
    lines: lines.map(
      (line, index) =>
        ({
          hasAssurance: line.hasAssurance ?? false,
          id: `import-${index}`,
          item: line.item,
          lineTotalMinor: 0,
          negotiatedUnitPriceMinor: line.negotiatedUnitPriceMinor,
          negotiationStatus: line.negotiationStatus,
          quantity: line.quantity,
          unitPriceMinor: 0,
          voucherAwardId: line.voucherAwardId,
          voucherToken: line.voucherToken,
        }) as CartLine
    ),
    merchantId: 'import-incoming',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 0,
  };
}

/**
 * Plans the one-time legacy import through the Task 6 merge rules: an
 * empty server takes every local line, a nonempty server takes the
 * merge diff (adds plus max-quantity sets), and conflicting
 * voucher/negotiation attachments report for explicit resolution
 * instead of silently overwriting. Derived operation keys make import
 * retries converge instead of duplicating.
 */
export function planLegacyImport(
  local: CartItem[],
  server: CartSnapshot | null,
  cartId: string | null,
  resolutions: import('@baci/shared/cart').CartMergeResolution[] = []
): PlannedLegacyImport {
  if (local.length === 0) return { kind: 'nothing' };
  const { clamped, lines } = inputLinesOf(local);
  const warnings: string[] = [];
  if (clamped) warnings.push('quantity_clamped');

  if (!server || !cartId) {
    // Never silently drop lines on first import: an over-capacity
    // cache blocks with the same actionable outcome as the
    // server-cart path until the shopper makes room.
    if (lines.length > SHARED_CART_MAX_LINES) {
      return {
        kind: 'blocked',
        code: 'too_many_lines',
        lineCount: lines.length,
      };
    }
    const fingerprint = lines
      .map((line) => JSON.stringify(line))
      .sort()
      .join('|');
    return {
      kind: 'create',
      lines,
      operationId: `import:create:${fnv1aHex(fingerprint)}`,
      warnings,
    };
  }

  // Preserve every device attachment lane. A partial merge cannot claim the
  // import completed: retain the cache until the shopper makes enough room.
  const planned = planCartMerge(server, syntheticIncoming(lines), resolutions);
  if (!planned.ok) {
    if (planned.code === 'merge_conflict') {
      return { conflicts: planned.conflicts, kind: 'conflicts' };
    }
    return {
      kind: 'blocked',
      code: planned.code,
      lineCount: planned.lineCount,
    };
  }
  // Match the merge planner's attachment lanes only for bases with siblings.
  // A lone conflicting offer still follows its explicit base-item resolution.
  const siblingBases = new Set<string>();
  for (const source of [server.lines, lines]) {
    const seen = new Set<string>();
    for (const line of source) {
      const base = cartLineIdentity(line.item);
      if (seen.has(base)) siblingBases.add(base);
      seen.add(base);
    }
  }
  const attachmentKey = (line: CartInputLine | CartLine): string =>
    JSON.stringify([
      cartLineIdentity(line.item),
      line.voucherToken ?? null,
      line.voucherAwardId ?? null,
      line.negotiatedUnitPriceMinor ?? null,
      line.negotiationStatus ?? null,
    ]);
  const keyOf = (line: CartInputLine | CartLine): string =>
    siblingBases.has(cartLineIdentity(line.item))
      ? attachmentKey(line)
      : cartLineIdentity(line.item);
  const serverByKey = new Map(server.lines.map((line) => [keyOf(line), line]));
  const adds: { line: CartInputLine; operationId: string }[] = [];
  const sets: { lineId: string; quantity: number }[] = [];
  const assurances: { lineId: string; hasAssurance: boolean }[] = [];
  for (const line of planned.lines) {
    const key = keyOf(line);
    const existing = serverByKey.get(key);
    if (!existing) {
      adds.push({
        line,
        operationId: `import:${cartId}:${fnv1aHex(attachmentKey(line))}`,
      });
    } else {
      if (existing.quantity !== line.quantity)
        sets.push({ lineId: existing.id, quantity: line.quantity });
      if ((line.hasAssurance ?? false) !== (existing.hasAssurance ?? false))
        assurances.push({
          lineId: existing.id,
          hasAssurance: line.hasAssurance ?? false,
        });
    }
  }
  if (
    planned.lines.some((line) => {
      const existing = serverByKey.get(keyOf(line));
      return existing
        ? attachmentKey(existing) !== attachmentKey(line)
        : line.hasAssurance === true;
    })
  )
    return {
      adds: [],
      assurances: [],
      sets: [],
      kind: 'commands',
      warnings,
      replacement: {
        lines: planned.lines,
        expectedVersion: server.version,
        operationId: `import:replace:${cartId}:${server.version}:${fnv1aHex(JSON.stringify(planned.lines))}`,
      },
    };
  return { adds, assurances, kind: 'commands', sets, warnings };
}
