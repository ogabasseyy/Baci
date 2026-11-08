import 'server-only';
import type { PiggyvestCaptureStatus } from '@/schemas/piggyvest/webhook-capture';
import {
  isPiggyvestCaptureDrainScheduled,
  isPiggyvestCaptureLegacyReplayEnabled,
} from './webhook-capture-attestation';
import {
  type CaptureDrainEvidence,
  drainAlertReason,
  drainLoginReason,
  drainScheduleReason,
} from './webhook-capture-drain-readiness';
import {
  isPrimaryLegacyBankInflowUnavailable,
  primaryIntakeReason,
} from './webhook-capture-primary-intake-readiness';
import {
  collectPiggyvestWebhookSecretsWithStatus,
  type PiggyvestWebhookKeyFamily,
} from './webhook-secret-union';

/**
 * Production readiness report for durable webhook capture (R5).
 *
 * Advisory only: it lists what is missing, it never gates or changes the
 * receiver's behaviour (capture is always on). The report carries gate
 * names, reasons and counts, never key material, bodies or signatures.
 */

const STALE_BACKLOG_MS = 15 * 60_000;

// The attestation turns every failed processing attempt into a deferred
// 200, but the worker-host drain cannot finish legacy-path deliveries.
const SCOPE_NOTE =
  'Legacy-family and record-only deliveries are set aside for review unless PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED=true is explicitly set on the worker. That lane requires the restricted webhook intake runtime and complete stored-signature verification; it reuses the receiver handler. Readiness does not claim legacy replay while the lane is off.';
const WORKER_HOST_NOTE =
  'Run on the worker host: the attestation (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED) is set on the web app and cannot be read here, so the reply a processing failure gets is not reported. A stale backlog is reported whenever the drain is enabled on this host.';

// The primary families the worker-host drain replays: a row signed by a
// family whose key this host lacks can only wait for configuration.
const DRAIN_REPLAY_FAMILIES: readonly PiggyvestWebhookKeyFamily[] = [
  'bank',
  'custody',
  'interest',
];

export type CaptureReadinessGate =
  | 'key_configuration'
  | 'primary_intake'
  | 'legacy_replay'
  | 'migration_and_table'
  | 'storage'
  | 'drain_login'
  | 'drain_schedule'
  | 'drain_alerts'
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
  /**
   * Worker-host evidence (dedicated login session, enable flag, cron entry);
   * absent where it cannot be collected, which reports NOT_CHECKED.
   */
  drain?: CaptureDrainEvidence;
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
   * attested, a deferred 200 once it is. 'unknown' on the worker host,
   * which cannot read the web app's attestation.
   */
  processingFailureReply: '503-retry' | '200-deferred' | 'unknown';
  /**
   * Every gate the attestation depends on passes: the only open gate, if
   * any, is the missing attestation itself (never a stale backlog).
   */
  readyToAttest: boolean;
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
    return {
      details,
      reason:
        collected.archiveIssue === 'FAMILY_CAP_EXCEEDED'
          ? 'KEY_ARCHIVE_FAMILY_CAP_EXCEEDED'
          : 'KEY_CONFIGURATION_UNREADABLE',
    };
  }
  if (current.length === 0) return { details, reason: 'NO_CURRENT_KEY' };
  if (!evidence.drain) return { details, reason: null };
  if (isPiggyvestCaptureLegacyReplayEnabled(evidence.env)) {
    return {
      details,
      reason: current.some((key) => key.family === 'legacy')
        ? null
        : 'DRAIN_FAMILY_KEY_MISSING:legacy',
    };
  }
  const missing = DRAIN_REPLAY_FAMILIES.filter(
    (family) => !current.some((key) => key.family === family)
  );
  return {
    details,
    reason: missing.length
      ? `DRAIN_FAMILY_KEY_MISSING:${missing.join(',')}`
      : null,
  };
}

function primaryReadinessReason(
  evidence: WebhookCaptureEvidence
): string | null {
  const primary = evidence.drain?.primaryIntake;
  if (!isPiggyvestCaptureLegacyReplayEnabled(evidence.env))
    return primaryIntakeReason(primary);
  if (!primary) return 'PRIMARY_INTAKE_NOT_CHECKED';
  const keys = collectPiggyvestWebhookSecretsWithStatus(
    evidence.env,
    evidence.now
  );
  const configured = new Set(
    [...keys.secrets, ...keys.replayOnly]
      .filter((key) => key.family !== 'legacy')
      .map((key) => key.family)
  );
  const unavailable = primary.notReady.filter((family) =>
    configured.has(family)
  );
  const legacyBankInflowUnavailable =
    primary.legacyBankInflowUnavailable ??
    isPrimaryLegacyBankInflowUnavailable(evidence.env);
  if (legacyBankInflowUnavailable) unavailable.push('bank');
  const uniqueUnavailable = [...new Set(unavailable)].sort();
  return uniqueUnavailable.length
    ? `PRIMARY_INTAKE_NOT_READY:${uniqueUnavailable.join(',')}`
    : null;
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
  // The worker host cannot see the web attestation, so it judges the
  // backlog whenever its own drain is enabled: that is exactly when the
  // receiver may have stopped asking the provider to redeliver.
  const judgeBacklog = evidence.drain
    ? evidence.drain.schedule.enabled
    : isPiggyvestCaptureDrainScheduled(evidence.env);
  if (!judgeBacklog) return evidence.drain ? null : 'DRAIN_NOT_SCHEDULED';
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
  const legacyEnabled = isPiggyvestCaptureLegacyReplayEnabled(evidence.env);
  const legacyRuntimeReady = evidence.drain?.legacyReplayRuntimeReady === true;
  const legacyReplayReason = legacyEnabled
    ? legacyRuntimeReady
      ? null
      : 'LEGACY_INTAKE_RUNTIME_NOT_READY'
    : null;
  const results: [CaptureReadinessGate, string | null][] = [
    ['key_configuration', keys.reason],
    ['primary_intake', primaryReadinessReason(evidence)],
    ['legacy_replay', legacyReplayReason],
    ['migration_and_table', storage.migration],
    ['storage', storage.storage],
    ['drain_login', drainLoginReason(evidence.drain)],
    ['drain_schedule', drainScheduleReason(evidence.drain)],
    ['drain_alerts', drainAlertReason(evidence.drain)],
    ['worker', workerReason(evidence)],
  ];
  const notReady = results.flatMap(([gate, reason]) =>
    reason ? [{ gate, reason }] : []
  );
  const drainAttested = isPiggyvestCaptureDrainScheduled(evidence.env);
  const reply = evidence.drain
    ? 'unknown'
    : drainAttested
      ? '200-deferred'
      : '503-retry';
  return {
    status: notReady.length === 0 ? 'ready' : 'not-ready',
    enforced: false,
    processingFailureReply: reply,
    readyToAttest: notReady.every(
      (entry) =>
        entry.gate === 'worker' && entry.reason === 'DRAIN_NOT_SCHEDULED'
    ),
    notes: [
      ...(reply === 'unknown'
        ? [WORKER_HOST_NOTE]
        : reply === '503-retry'
          ? [
              'The deferred 200 reply for a failed processing attempt is only active once the drain is scheduled (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true). Until then the receiver answers 503 so the provider redelivers.',
            ]
          : []),
      SCOPE_NOTE,
    ],
    checks: results.map(([gate, reason]) => ({
      gate,
      passed: reason === null,
    })),
    notReady,
    details: keys.details,
  };
}
