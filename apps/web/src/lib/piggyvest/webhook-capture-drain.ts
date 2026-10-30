import 'server-only';
import type { PiggyvestClaimedCapture } from '@/schemas/piggyvest/webhook-capture';
import type { StoredPiggyvestDeliveryVerification } from './verify-stored-piggyvest-delivery';
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
  }): StoredPiggyvestDeliveryVerification;
  /** Runs the shared processing pipeline; a non-2xx status means incomplete. */
  process(delivery: ReplayDelivery): Promise<{ status: number }>;
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

async function drainRow(
  deps: DrainDeps,
  row: PiggyvestClaimedCapture
): Promise<RowOutcome> {
  const rawBody = Buffer.from(row.raw_hex, 'hex');
  const verification = deps.verify({ rawBody, signature: row.signature });

  if (verification.status === 'unconfigured') {
    await settle(deps, row, 'pending', 'KEYS_UNCONFIGURED');
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

  let completed = false;
  try {
    const result = await deps.process({
      rawBody,
      signature: row.signature,
      matchedSecret: verification.secret,
      families: verification.families,
    });
    completed = result.status >= 200 && result.status < 300;
  } catch {
    completed = false;
  }
  if (completed) {
    await settle(deps, row, 'processed', null);
    return 'processed';
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
