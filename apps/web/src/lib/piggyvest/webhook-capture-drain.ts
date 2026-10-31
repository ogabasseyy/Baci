import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import { primaryOwnerFamily } from './primary-event-owner';
import {
  narrowToRecordedFamilies,
  type StoredPiggyvestDeliveryVerification,
} from './verify-stored-piggyvest-delivery';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import {
  MAX_DRAIN_ATTEMPTS,
  type ReplayProcessResult,
  settleReplayResult,
} from './webhook-capture-drain-result';
import {
  deferForIncompleteKeySet,
  deferOutOfScope,
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

export { MAX_DRAIN_ATTEMPTS, type ReplayProcessResult };

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
   * Runs a processing pipeline over the stored bytes. A non-2xx status
   * means incomplete, and so does every marker of ReplayProcessResult (an
   * acknowledged quarantine ran no financial handler): such a row is never
   * resolved processed. See webhook-capture-drain-result.ts.
   */
  process(delivery: ReplayDelivery): Promise<ReplayProcessResult>;
  /**
   * Optional replay scope, checked before anything else. A runtime that
   * does not hold every processing path (the worker-host drain holds no
   * service-role authority) names why it must leave a row alone; the row
   * is then deferred with an alert, unverified and unprocessed.
   */
  outOfScope?(row: PiggyvestClaimedCapture): string | null;
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
  const scope = deps.outOfScope?.(row) ?? null;
  if (scope) return deferOutOfScope(deps, row, scope);

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

  let result: ReplayProcessResult | null = null;
  try {
    result = await deps.process({
      rawBody,
      signature: row.signature,
      matchedSecret: verification.secret,
      families,
      incompleteKeySet: verification.incompleteKeySet,
      keyScope: 'replay',
    });
  } catch {
    result = null;
  }
  return settleReplayResult(
    deps,
    row,
    result,
    verification.incompleteKeySet === true
  );
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
