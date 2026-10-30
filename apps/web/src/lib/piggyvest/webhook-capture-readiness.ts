import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  type PiggyvestCaptureStatus,
  piggyvestCaptureStatusSchema,
} from '@/schemas/piggyvest/webhook-capture';
import { isPiggyvestCaptureDrainScheduled } from './webhook-capture-attestation';
import { collectPiggyvestWebhookSecretsWithStatus } from './webhook-secret-union';

/**
 * Production readiness report for durable webhook capture (R5).
 *
 * Advisory only: it lists what is missing, it never gates or changes the
 * receiver's behaviour (capture is always on). The report carries gate
 * names, reasons and counts, never key material, bodies or signatures.
 */

const STALE_BACKLOG_MS = 15 * 60_000;

export type CaptureReadinessGate =
  | 'key_configuration'
  | 'migration_and_table'
  | 'storage'
  | 'worker';

export type CaptureStorageEvidence =
  | { ok: true; status: PiggyvestCaptureStatus }
  | {
      ok: false;
      reason: 'function_missing' | 'unreachable' | 'invalid_response';
    };

export interface WebhookCaptureEvidence {
  env: NodeJS.ProcessEnv;
  now: Date;
  storage: CaptureStorageEvidence;
}

export interface CaptureReadinessEntry {
  gate: CaptureReadinessGate;
  reason: string;
}

export interface WebhookCaptureReadinessReport {
  status: 'ready' | 'not-ready';
  /** Capture stays on regardless; this report never blocks the receiver. */
  enforced: false;
  /**
   * What the receiver answers when processing fails after a delivery was
   * captured: a 503 (provider redelivery is the retry) until the drain is
   * attested, a deferred 200 once it is.
   */
  processingFailureReply: '503-retry' | '200-deferred';
  notes: string[];
  checks: { gate: CaptureReadinessGate; passed: boolean }[];
  notReady: CaptureReadinessEntry[];
  details: { currentKeys: number; overlapKeys: number; replayOnlyKeys: number };
}

function keyConfiguration(evidence: WebhookCaptureEvidence) {
  const collected = collectPiggyvestWebhookSecretsWithStatus(
    evidence.env,
    evidence.now
  );
  const current = collected.secrets.filter((key) => key.status === 'current');
  const details = {
    currentKeys: current.length,
    overlapKeys: collected.secrets.length - current.length,
    replayOnlyKeys: collected.replayOnly.length,
  };
  if (collected.misconfigured) {
    return { details, reason: 'KEY_CONFIGURATION_UNREADABLE' };
  }
  return { details, reason: current.length === 0 ? 'NO_CURRENT_KEY' : null };
}

function storageReasons(storage: CaptureStorageEvidence): {
  migration: string | null;
  storage: string | null;
} {
  if (storage.ok) return { migration: null, storage: null };
  if (storage.reason === 'function_missing') {
    return {
      migration: 'CAPTURE_FUNCTIONS_MISSING',
      storage: 'NOT_VERIFIABLE_WITHOUT_MIGRATION',
    };
  }
  if (storage.reason === 'unreachable') {
    return {
      migration: 'NOT_VERIFIABLE_WITHOUT_STORAGE',
      storage: 'STORAGE_UNREACHABLE',
    };
  }
  return {
    migration: 'STORAGE_RESPONSE_INVALID',
    storage: 'STORAGE_RESPONSE_INVALID',
  };
}

function workerReason(evidence: WebhookCaptureEvidence): string | null {
  if (!isPiggyvestCaptureDrainScheduled(evidence.env)) {
    return 'DRAIN_NOT_SCHEDULED';
  }
  if (evidence.storage.ok) {
    const oldest = evidence.storage.status.oldestUnprocessedAt;
    const age = oldest ? evidence.now.getTime() - Date.parse(oldest) : 0;
    if (Number.isFinite(age) && age > STALE_BACKLOG_MS) {
      return 'DRAIN_BACKLOG_STALE';
    }
  }
  return null;
}

export function inspectPiggyvestWebhookCaptureReadiness(
  evidence: WebhookCaptureEvidence
): WebhookCaptureReadinessReport {
  const keys = keyConfiguration(evidence);
  const storage = storageReasons(evidence.storage);
  const results: [CaptureReadinessGate, string | null][] = [
    ['key_configuration', keys.reason],
    ['migration_and_table', storage.migration],
    ['storage', storage.storage],
    ['worker', workerReason(evidence)],
  ];
  const notReady = results.flatMap(([gate, reason]) =>
    reason ? [{ gate, reason }] : []
  );
  const drainAttested = isPiggyvestCaptureDrainScheduled(evidence.env);
  return {
    status: notReady.length === 0 ? 'ready' : 'not-ready',
    enforced: false,
    processingFailureReply: drainAttested ? '200-deferred' : '503-retry',
    notes: drainAttested
      ? []
      : [
          'The deferred 200 reply for a failed processing attempt is only active once the drain is scheduled (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true). Until then the receiver answers 503 so the provider redelivers.',
        ],
    checks: results.map(([gate, reason]) => ({
      gate,
      passed: reason === null,
    })),
    notReady,
    details: keys.details,
  };
}

/** Reads the counters through the status function (metadata only). */
export async function collectPiggyvestWebhookCaptureEvidence(input: {
  client: PiggyvestIntakeServiceClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<WebhookCaptureEvidence> {
  const db: SupabaseClient = input.client;
  const base = { env: input.env ?? process.env, now: input.now ?? new Date() };
  try {
    const { data, error } = await db.rpc('piggyvest_webhook_capture_status');
    if (error) {
      const missing = ['PGRST202', '42883', '42P01'].includes(
        String((error as { code?: unknown }).code)
      );
      return {
        ...base,
        storage: {
          ok: false,
          reason: missing ? 'function_missing' : 'unreachable',
        },
      };
    }
    const parsed = piggyvestCaptureStatusSchema.safeParse(data);
    return {
      ...base,
      storage: parsed.success
        ? { ok: true, status: parsed.data }
        : { ok: false, reason: 'invalid_response' },
    };
  } catch {
    return { ...base, storage: { ok: false, reason: 'unreachable' } };
  }
}
