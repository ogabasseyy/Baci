import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import {
  narrowToRecordedFamilies,
  type StoredPiggyvestDeliveryVerification,
} from './verify-stored-piggyvest-delivery';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import type { CaptureResolution } from './webhook-capture-queue';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

/**
 * Processing of captured deliveries, separate from the receiver (R5).
 *
 * The receiver stores the exact request and answers 200; this drain
 * consumes stored rows and runs the same processing pipeline over the
 * stored bytes. Because processing is keyed on the provider transaction id
 * (inflow transaction id, payout id) by the downstream ledgers, replaying a
 * row any number of times, including after a crash between processing and
 * completion, applies each provider transaction once.
 *
 * Authenticity is re-established on every replay: the stored bytes and
 * signature are re-verified against current, overlap and replay-only
 * archived keys, so a revoked key still replays what it legitimately
 * signed, while bytes that no key vouches for are never processed.
 */

export const MAX_DRAIN_ATTEMPTS = 20;
const DEFAULT_BATCH = 25;

export interface ReplayDelivery {
  rawBody: Buffer;
  signature: string;
  matchedSecret: string;
  families: readonly PiggyvestWebhookKeyFamily[];
  /**
   * Part of the key set was unavailable when the replay verified, so
   * `families` may be only part of what the recorded authority covers.
   */
  incompleteKeySet?: boolean;
  /** Stored bytes may use the family's archived keys past their overlap. */
  keyScope: 'replay';
}

export interface DrainDeps {
  claim(limit: number): Promise<PiggyvestClaimedCapture[]>;
  resolve(
    captureId: string,
    claimToken: string,
    state: CaptureResolution,
    error: string | null
  ): Promise<boolean>;
  verify(input: {
    rawBody: Buffer;
    signature: string;
    /** Families durably recorded at admission: the ceiling on authority. */
    recordedFamilies: readonly PiggyvestWebhookKeyFamily[];
  }): StoredPiggyvestDeliveryVerification;
  /**
   * Runs the shared processing pipeline. A non-2xx status means incomplete,
   * and so does an authorization quarantine (the wrong key family signed
   * and so does an authorization quarantine (the wrong key family signed
   * it, so no financial handler ran): that row is never resolved processed.
   * `keySetIncomplete` marks a retry that only a complete key set can settle
   * (the loaded families could not authorize the event): that row is
   * deferred, not failed.
   */
  process(delivery: ReplayDelivery): Promise<{
    status: number;
    authorizationQuarantine?: boolean;
    keySetIncomplete?: boolean;
  }>;
}

export interface DrainSummary {
  claimed: number;
  processed: number;
  retried: number;
  needsReview: number;
}

type RowOutcome = 'processed' | 'retried' | 'needsReview';

async function settle(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  state: CaptureResolution,
  error: string | null
): Promise<void> {
  try {
    await deps.resolve(row.capture_id, row.claim_token, state, error);
  } catch {
    // The lease expires and the row is claimed again; replay is idempotent.
    console.warn('[PiggyVest Webhook] Failed to resolve captured delivery');
  }
}

/**
 * Defer a row because the key set is incomplete. Nothing about the row is
 * judged (even a permanent failure stays recoverable), so the deferral must
 * be visible: operators learn about the incomplete configuration from the
 * alert instead of finding stuck rows later. No secret or body is logged.
 */
async function deferForIncompleteKeySet(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture,
  reason: string
): Promise<void> {
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
    captureId: row.capture_id,
    eventType: row.event_type,
    reason: `replay deferred, key set incomplete: ${reason}`,
  });
  await settle(deps, row, 'deferred', 'KEY_SET_INCOMPLETE');
}

async function drainRow(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture
): Promise<RowOutcome> {
  const rawBody = Buffer.from(row.raw_hex, 'hex');
  const verification = deps.verify({
    rawBody,
    signature: row.signature,
    recordedFamilies: row.key_families,
  });

  if (verification.status === 'unconfigured') {
    // An incomplete key set says nothing about the row, so it is deferred,
    // not failed: the database refunds the attempt the claim spent, backs
    // the retry off (bounded) and orders the row behind fresher captures.
    // Releasing it as plain 'pending' would re-claim the same oldest blocked
    // rows first on every run and starve every later capture.
    await settle(deps, row, 'deferred', 'KEYS_UNCONFIGURED');
    return 'retried';
  }
  if (verification.status === 'unverifiable') {
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE', {
      captureId: row.capture_id,
      keyVersion: row.key_version,
    });
    await settle(deps, row, 'needs_review', 'REPLAY_SIGNATURE_UNVERIFIABLE');
    return 'needsReview';
  }

  // Authority is the intersection of what replay verification reports and
  // what admission recorded, whatever the injected verifier did: replay
  // re-proves authenticity but never widens what ingress authorised.
  const families =
    verification.status === 'verified'
      ? narrowToRecordedFamilies(verification.families, row.key_families)
      : [];
  if (
    verification.status === 'verified' &&
    families.length === 0 &&
    verification.incompleteKeySet === true
  ) {
    // The recorded family's assignment may simply not be loaded: not lost.
    await deferForIncompleteKeySet(deps, row, 'replay authority not loaded');
    return 'retried';
  }
  if (verification.status !== 'verified' || families.length === 0) {
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', {
      captureId: row.capture_id,
      eventType: row.event_type,
      keyVersion: row.key_version,
      reason: 'replay authority not recorded at admission',
    });
    await settle(deps, row, 'needs_review', 'REPLAY_AUTHORITY_NOT_RECORDED');
    return 'needsReview';
  }

  let completed = false;
  let keySetIncomplete = false;
  try {
    const result = await deps.process({
      rawBody,
      signature: row.signature,
      matchedSecret: verification.secret,
      families,
      incompleteKeySet: verification.incompleteKeySet,
      keyScope: 'replay',
    });
    completed =
      result.status >= 200 &&
      result.status < 300 &&
      result.authorizationQuarantine !== true;
    keySetIncomplete = result.keySetIncomplete === true;
  } catch {
    completed = false;
  }
  if (completed) {
    await settle(deps, row, 'processed', null);
    return 'processed';
  }
  if (keySetIncomplete || verification.incompleteKeySet === true) {
    // The key set is incomplete (the replay verified under only the
    // families that loaded), so ANY unsuccessful outcome (a non-2xx answer,
    // a thrown error, an authorization quarantine, or the explicit marker)
    // may just be the missing assignment. It is not a failure of the row:
    // defer (attempt refunded, bounded backoff, never dead-lettered) so a
    // repaired configuration resumes it.
    await deferForIncompleteKeySet(deps, row, 'processing incomplete');
    return 'retried';
  }
  if (row.attempts >= MAX_DRAIN_ATTEMPTS) {
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_NEEDS_REVIEW', {
      captureId: row.capture_id,
      eventType: row.event_type,
      attempts: row.attempts,
      reason: 'processing attempts exhausted',
    });
    await settle(deps, row, 'needs_review', 'PROCESSING_ATTEMPTS_EXHAUSTED');
    return 'needsReview';
  }
  await settle(deps, row, 'pending', 'PROCESSING_INCOMPLETE');
  return 'retried';
}

export async function drainPiggyvestWebhookCaptures(
  deps: DrainDeps,
  options: { limit?: number } = {}
): Promise<DrainSummary> {
  const rows = await deps.claim(options.limit ?? DEFAULT_BATCH);
  const summary: DrainSummary = {
    claimed: rows.length,
    processed: 0,
    retried: 0,
    needsReview: 0,
  };
  for (const row of rows) {
    const outcome = await drainRow(deps, row);
    summary[outcome] += 1;
  }
  return summary;
}
