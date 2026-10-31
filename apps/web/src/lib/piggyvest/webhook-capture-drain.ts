import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { primaryOwnerFamily } from './primary-event-owner';
import {
  narrowToRecordedFamilies,
  type StoredPiggyvestDeliveryVerification,
} from './verify-stored-piggyvest-delivery';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import {
  deferForIncompleteKeySet,
  parkForReview,
  type RowOutcome,
  settle,
} from './webhook-capture-drain-settle';
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
   * and so does an acknowledged quarantine, which ran no financial handler:
   * `authorizationQuarantine` (the wrong key family signed it) and
   * `contentQuarantine` (the body was unparseable or schema-rejected). Such a
   * row is never resolved processed. `keySetIncomplete` marks a retry that
   * only a complete key set can settle (the loaded families could not
   * authorize the event): that row is deferred, not failed.
   */
  process(delivery: ReplayDelivery): Promise<{
    status: number;
    authorizationQuarantine?: boolean;
    contentQuarantine?: boolean;
    keySetIncomplete?: boolean;
  }>;
}

export interface DrainSummary {
  claimed: number;
  processed: number;
  retried: number;
  needsReview: number;
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
    return parkForReview(
      deps,
      row,
      'REPLAY_AUTHORITY_NOT_RECORDED',
      'replay authority not recorded at admission'
    );
  }

  // A primary-owned event type is never completed by the legacy fallback
  // while its owning family is missing from the processing families. The
  // recorded authority is immutable and replay never widens it.
  const owner = primaryOwnerFamily(row.event_type ?? '');
  if (owner && !families.includes(owner)) {
    const heldButNotRecorded = verification.keyFamilies?.includes(owner);
    const recordedButLost = row.key_families.includes(owner);
    if (heldButNotRecorded || recordedButLost) {
      if (!heldButNotRecorded && verification.incompleteKeySet === true) {
        // The recorded owner's assignment may simply not be loaded right now.
        await deferForIncompleteKeySet(deps, row, 'owner family not loaded');
        return 'retried';
      }
      return heldButNotRecorded
        ? parkForReview(
            deps,
            row,
            'OWNER_FAMILY_NOT_RECORDED',
            'owning family not recorded at admission; request a resend'
          )
        : parkForReview(
            deps,
            row,
            'OWNER_AUTHORITY_LOST',
            'recorded owning family no longer held by the key'
          );
    }
  }

  let completed = false;
  let keySetIncomplete = false;
  let authorizationQuarantine = false;
  let contentQuarantine = false;
  try {
    const result = await deps.process({
      rawBody,
      signature: row.signature,
      matchedSecret: verification.secret,
      families,
      incompleteKeySet: verification.incompleteKeySet,
      keyScope: 'replay',
    });
    authorizationQuarantine = result.authorizationQuarantine === true;
    contentQuarantine = result.contentQuarantine === true;
    completed =
      result.status >= 200 &&
      result.status < 300 &&
      !authorizationQuarantine &&
      !contentQuarantine;
    keySetIncomplete = result.keySetIncomplete === true;
  } catch {
    completed = false;
  }
  if (completed) {
    await settle(deps, row, 'processed', null);
    return 'processed';
  }
  if (contentQuarantine) {
    // The bytes verified, so the key set cannot change this outcome: only a
    // parser fix plus a resend can make them processable.
    return parkForReview(
      deps,
      row,
      'REPLAY_CONTENT_QUARANTINED',
      'body rejected by the parser; request a resend after the fix'
    );
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
  if (authorizationQuarantine) {
    // Signed by a family not authorized for this event, with a complete key
    // set and immutable recorded authority: replay can never succeed, so it
    // must not take 20 batch slots. A correctly signed redelivery has its
    // own capture row.
    return parkForReview(
      deps,
      row,
      'REPLAY_AUTHORIZATION_QUARANTINED',
      'signed by a key family not authorized for this event'
    );
  }
  if (row.attempts >= MAX_DRAIN_ATTEMPTS) {
    return parkForReview(
      deps,
      row,
      'PROCESSING_ATTEMPTS_EXHAUSTED',
      'processing attempts exhausted',
      row.attempts
    );
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
