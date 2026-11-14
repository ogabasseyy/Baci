import 'server-only';
import { isPostHogServerConfigured } from '@/lib/posthog/server';
import { piggyvestCaptureStatusRowSchema } from '@/schemas/piggyvest/webhook-capture-drain-runtime';
import { isPiggyvestCaptureDrainEnabled } from './webhook-capture-attestation';
import type {
  CaptureDrainExecutor,
  CaptureDrainSessionCheck,
} from './webhook-capture-pg-executor';
import {
  collectPrimaryIntakeEvidence,
  type PrimaryIntakeEvidence,
} from './webhook-capture-primary-intake-readiness';
import type { WebhookCaptureEvidence } from './webhook-capture-readiness';
import { isPiggyvestWebhookIntakeRuntimeReady } from './webhook-intake-runtime';

/**
 * Evidence the worker host collects before the owner attests the capture
 * drain (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true on the web app):
 * the dedicated login really is the narrow drain session, the drain is
 * both enabled and scheduled on this host, and the primary intakes it
 * replays through are enabled here. Metadata only: no key, password,
 * body or signature is read into the report.
 */

export type CaptureDrainLoginEvidence =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'unreachable' }
  | { ok: false; reason: 'unsafe'; failedChecks: CaptureDrainSessionCheck[] };

export type CaptureDrainCronState =
  | 'installed'
  | 'missing'
  | 'duplicated'
  | 'unreadable';

export interface CaptureDrainEvidence {
  login: CaptureDrainLoginEvidence;
  schedule: { enabled: boolean; cron: CaptureDrainCronState };
  /** Which primary intakes can finish a replayed delivery on this host. */
  primaryIntake: PrimaryIntakeEvidence;
  /** Restricted legacy intake runtime is configured when its lane is enabled. */
  legacyReplayRuntimeReady?: boolean;
  /**
   * Whether the drain's alerts leave this host. The console line only
   * reaches a local log file here, so paging relies on the server-side
   * PostHog money alert (see docs/piggyvest-money-alerts.md).
   */
  alerts: { configured: boolean };
}

/**
 * The deployed entry shape (vps-workers/deploy.sh): every minute, flock on
 * the drain lock, the production profile exports, a 50s bound, and the
 * wrapper under the same worker root run once. The root is captured once and
 * must match everywhere it appears, so an entry that merely mentions these
 * strings, or runs a different root or profile, does not count.
 */
const CRON_ENTRY =
  /^\*\s+\*\s+\*\s+\*\s+\*\s+flock -n (\S+)\/locks\/piggyvest-webhook-capture-drain\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=piggyvest-webhook-capture-drain && cd \1 && timeout --verbose --signal=TERM --kill-after=10s 50s \1\/bin\/process-piggyvest-webhook-capture-drain\.sh --once' >> \1\/logs\/piggyvest-webhook-capture-drain\.log 2>&1$/;

/** Exactly one active, every-minute, flock-guarded drain entry. */
export function captureDrainCronState(
  crontab: string | null
): CaptureDrainCronState {
  if (crontab === null) return 'unreadable';
  const entries = crontab
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => CRON_ENTRY.test(line));
  if (entries.length === 0) return 'missing';
  return entries.length === 1 ? 'installed' : 'duplicated';
}

export function drainLoginReason(
  drain: CaptureDrainEvidence | undefined
): string | null {
  if (!drain) return 'DRAIN_LOGIN_NOT_CHECKED';
  if (drain.login.ok) return null;
  if (drain.login.reason === 'not_configured') {
    return 'DRAIN_LOGIN_NOT_CONFIGURED';
  }
  return drain.login.reason === 'unsafe'
    ? 'DRAIN_LOGIN_UNSAFE'
    : 'DRAIN_LOGIN_UNREACHABLE';
}

export function drainScheduleReason(
  drain: CaptureDrainEvidence | undefined
): string | null {
  if (!drain) return 'DRAIN_SCHEDULE_NOT_CHECKED';
  if (!drain.schedule.enabled) return 'DRAIN_NOT_ENABLED';
  const reasons: Record<CaptureDrainCronState, string | null> = {
    installed: null,
    missing: 'DRAIN_CRON_NOT_INSTALLED',
    duplicated: 'DRAIN_CRON_DUPLICATED',
    unreadable: 'DRAIN_CRON_UNREADABLE',
  };
  return reasons[drain.schedule.cron];
}

export function drainAlertReason(
  drain: CaptureDrainEvidence | undefined
): string | null {
  if (!drain) return 'DRAIN_ALERTS_NOT_CHECKED';
  return drain.alerts.configured ? null : 'DRAIN_ALERTS_NOT_CONFIGURED';
}

// Undefined function or table, or no EXECUTE grant: the migration that
// creates or grants them has not been applied to this database.
const MIGRATION_STATES = new Set(['42883', '42P01', '42501']);

async function storageEvidence(
  executor: CaptureDrainExecutor | null
): Promise<WebhookCaptureEvidence['storage']> {
  if (!executor) return { ok: false, reason: 'unreachable' };
  try {
    const rows = await executor.query('status', []);
    const parsed =
      rows.length === 1
        ? piggyvestCaptureStatusRowSchema.safeParse(rows[0])
        : null;
    return parsed?.success
      ? { ok: true, status: parsed.data.status }
      : { ok: false, reason: 'invalid_response' };
  } catch (error) {
    const sqlState = (error as { sqlState?: unknown }).sqlState;
    return typeof sqlState === 'string' && MIGRATION_STATES.has(sqlState)
      ? { ok: false, reason: 'function_missing' }
      : { ok: false, reason: 'unreachable' };
  }
}

export async function collectCaptureDrainEvidence(input: {
  env: NodeJS.ProcessEnv;
  now: Date;
  /** Null when the drain login is not configured on this host. */
  executor: CaptureDrainExecutor | null;
  readCrontab: () => Promise<string | null>;
}): Promise<WebhookCaptureEvidence> {
  const { env, now, executor } = input;
  const [storage, login, crontab] = await Promise.all([
    storageEvidence(executor),
    executor
      ? executor.verifySession()
      : Promise.resolve({ ok: false, reason: 'not_configured' } as const),
    input.readCrontab().catch(() => null),
  ]);
  return {
    env,
    now,
    storage,
    drain: {
      login,
      schedule: {
        enabled: isPiggyvestCaptureDrainEnabled(env),
        cron: captureDrainCronState(crontab),
      },
      primaryIntake: collectPrimaryIntakeEvidence(env, now),
      legacyReplayRuntimeReady: isPiggyvestWebhookIntakeRuntimeReady(env),
      alerts: { configured: isPostHogServerConfigured(env) },
    },
  };
}
