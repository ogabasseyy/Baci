/**
 * Event-cursor rules (R0 spike, pure functions).
 *
 * The cursor is bound to one connector grant, one merchant, and one branch
 * filter. Positions come from the future R2 post-commit per-tenant
 * projection — never from an ordinary sequence — so these helpers only
 * enforce binding and advance rules, never allocate positions.
 */

import { createHash } from 'node:crypto';

const CURSOR_VERSION = 1;

export interface ConnectorCursorPayload {
  v: number;
  grantId: string;
  merchantId: string;
  branchHash: string;
  position: number;
}

export function branchFilterHash(branchIds: string[] | null): string {
  if (branchIds === null) return 'merchant';
  return createHash('sha256')
    .update([...branchIds].sort().join(','))
    .digest('hex')
    .slice(0, 32);
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

export function encodeConnectorCursor(payload: ConnectorCursorPayload): string {
  return encodeBase64Url(JSON.stringify(payload));
}

export function decodeConnectorCursor(
  cursor: string
): ConnectorCursorPayload | null {
  const raw = decodeBase64Url(cursor);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (
    record.v !== CURSOR_VERSION ||
    typeof record.grantId !== 'string' ||
    typeof record.merchantId !== 'string' ||
    typeof record.branchHash !== 'string' ||
    typeof record.position !== 'number' ||
    !Number.isInteger(record.position) ||
    record.position < 0
  ) {
    return null;
  }
  return {
    v: CURSOR_VERSION,
    grantId: record.grantId,
    merchantId: record.merchantId,
    branchHash: record.branchHash,
    position: record.position,
  };
}

export interface CursorBinding {
  grantId: string;
  merchantId: string;
  branchIds: string[] | null;
}

/**
 * A cursor from another grant, merchant, or branch filter is rejected.
 * Callers map `false` to a denial (never silent resync).
 */
export function isCursorBoundTo(
  cursor: ConnectorCursorPayload,
  binding: CursorBinding
): boolean {
  return (
    cursor.grantId === binding.grantId &&
    cursor.merchantId === binding.merchantId &&
    cursor.branchHash === branchFilterHash(binding.branchIds)
  );
}

/**
 * Advance only to the highest position actually returned. Empty reads
 * preserve the supplied cursor; positions never move backwards.
 */
export function advanceCursor(
  current: ConnectorCursorPayload,
  highestReturned: number | null
): ConnectorCursorPayload {
  if (highestReturned === null || highestReturned <= current.position) {
    return current;
  }
  return { ...current, position: highestReturned };
}

export function initialCursorFor(binding: CursorBinding): string {
  return encodeConnectorCursor({
    v: CURSOR_VERSION,
    grantId: binding.grantId,
    merchantId: binding.merchantId,
    branchHash: branchFilterHash(binding.branchIds),
    position: 0,
  });
}
