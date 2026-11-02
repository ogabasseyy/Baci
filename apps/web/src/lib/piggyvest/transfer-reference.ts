/**
 * Attempt references for PiggyVest wallet transfers:
 * `pvb-<kind>-<legId>-<attempt>`.
 *
 * - `kind` names the rail. Only `wt` (the wallet-transfer engine) exists.
 * - `legId` is the transfer leg's UUID in canonical lowercase, exactly as
 *   Postgres prints `uuid::text`.
 * - `attempt` is 1 to 1000 with no leading zeros, as Postgres prints
 *   `integer::text`.
 *
 * The text matches the engine's own construction
 * (`'pvb-wt-' || transfer_id::text || '-' || attempt::text`), and every
 * reference has exactly one spelling, so decode and encode round-trip.
 *
 * A reference is sent to PiggyVest at most once. A retry after a proven
 * failure is a NEW attempt with a higher number, never the same reference
 * again (PiggyVest has not confirmed that a repeated reference is
 * idempotent). The legacy savings reference `pvb-save-<operationId>` is a
 * single-attempt reference and is not decoded here.
 */
export const TRANSFER_REFERENCE_KINDS = ['wt'] as const;
export type TransferReferenceKind = (typeof TRANSFER_REFERENCE_KINDS)[number];

export const MAX_TRANSFER_ATTEMPT = 1000;

export interface TransferAttemptReference {
  kind: TransferReferenceKind;
  legId: string;
  attempt: number;
}

export type TransferReferenceErrorCode =
  | 'TRANSFER_REFERENCE_INVALID'
  | 'TRANSFER_ATTEMPT_REUSED'
  | 'TRANSFER_ATTEMPT_HISTORY_FOREIGN'
  | 'TRANSFER_ATTEMPTS_EXHAUSTED';

export class TransferReferenceError extends Error {
  readonly code: TransferReferenceErrorCode;

  constructor(code: TransferReferenceErrorCode) {
    super(code);
    this.name = 'TransferReferenceError';
    this.code = code;
  }
}

const LEG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE =
  /^pvb-([a-z]+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9][0-9]{0,3})$/;

function isKind(value: string): value is TransferReferenceKind {
  return (TRANSFER_REFERENCE_KINDS as readonly string[]).includes(value);
}

function isAttempt(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_TRANSFER_ATTEMPT;
}

export function encodeTransferReference(
  parts: TransferAttemptReference
): string {
  if (
    !isKind(parts.kind) ||
    !LEG_ID.test(parts.legId) ||
    !isAttempt(parts.attempt)
  )
    throw new TransferReferenceError('TRANSFER_REFERENCE_INVALID');
  return `pvb-${parts.kind}-${parts.legId}-${parts.attempt}`;
}

/** Our attempt reference's parts, or null for anything that is not one. */
export function decodeTransferReference(
  reference: unknown
): TransferAttemptReference | null {
  if (typeof reference !== 'string') return null;
  const match = REFERENCE.exec(reference);
  if (!match) return null;
  const [, kind = '', legId = '', attemptText = ''] = match;
  const attempt = Number(attemptText);
  if (!isKind(kind) || !isAttempt(attempt)) return null;
  return { kind, legId, attempt };
}

function highestAttempt(
  kind: TransferReferenceKind,
  legId: string,
  previous: readonly string[]
): number {
  let highest = 0;
  for (const reference of previous) {
    const parts = decodeTransferReference(reference);
    // A history it cannot read gives no proof that an attempt is fresh.
    if (!parts || parts.kind !== kind || parts.legId !== legId)
      throw new TransferReferenceError('TRANSFER_ATTEMPT_HISTORY_FOREIGN');
    highest = Math.max(highest, parts.attempt);
  }
  return highest;
}

/**
 * The reference for `attempt`, refused unless it is newer than every
 * attempt this leg already used (`previous`: all of the leg's references).
 */
export function mintTransferReference(input: {
  kind: TransferReferenceKind;
  legId: string;
  attempt: number;
  previous: readonly string[];
}): string {
  const reference = encodeTransferReference(input);
  if (input.attempt <= highestAttempt(input.kind, input.legId, input.previous))
    throw new TransferReferenceError('TRANSFER_ATTEMPT_REUSED');
  return reference;
}

/** The leg's next attempt reference after every attempt in `previous`. */
export function nextTransferReference(input: {
  kind: TransferReferenceKind;
  legId: string;
  previous: readonly string[];
}): string {
  const attempt = highestAttempt(input.kind, input.legId, input.previous) + 1;
  if (attempt > MAX_TRANSFER_ATTEMPT)
    throw new TransferReferenceError('TRANSFER_ATTEMPTS_EXHAUSTED');
  return mintTransferReference({ ...input, attempt });
}
