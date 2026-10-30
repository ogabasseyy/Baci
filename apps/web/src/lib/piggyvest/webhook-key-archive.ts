import 'server-only';
import { createHmac } from 'node:crypto';
import {
  type PiggyvestArchivedWebhookKey,
  piggyvestWebhookKeyArchiveSchema,
} from '@/schemas/piggyvest/webhook-key-archive';

export const DEFAULT_WEBHOOK_KEY_OVERLAP_HOURS = 72;
export const MAX_WEBHOOK_KEY_OVERLAP_HOURS = 168;
const HOUR_MS = 3_600_000;
// A retirement stamp meaningfully in the future is an operator typo; letting
// it stand would keep a key accepted far past any bounded overlap.
const CLOCK_SKEW_MS = 5 * 60_000;

export type WebhookKeyArchive =
  | { ok: true; entries: PiggyvestArchivedWebhookKey[]; overlapMs: number }
  | { ok: false };

/**
 * Overlap window for a rotated-out key. Bounded on both sides: an unset or
 * unparseable value falls back to the 72 hour default and an oversized one
 * is clamped, so a typo can never keep a revoked key alive for weeks.
 */
export function readWebhookKeyOverlapMs(env: NodeJS.ProcessEnv): number {
  const raw = env.PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS?.trim();
  const hours = raw && /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(hours) || hours < 1) {
    return DEFAULT_WEBHOOK_KEY_OVERLAP_HOURS * HOUR_MS;
  }
  return Math.min(hours, MAX_WEBHOOK_KEY_OVERLAP_HOURS) * HOUR_MS;
}

/**
 * Reads the retired-key archive. An unreadable archive is `ok: false`
 * (never silently empty): the caller must not call an unmatched delivery
 * invalid when the key set it checked may be incomplete.
 */
export function readWebhookKeyArchive(
  env: NodeJS.ProcessEnv
): WebhookKeyArchive {
  const overlapMs = readWebhookKeyOverlapMs(env);
  const raw = env.PIGGYVEST_WEBHOOK_KEY_ARCHIVE?.trim();
  if (!raw) return { ok: true, entries: [], overlapMs };
  try {
    const parsed = piggyvestWebhookKeyArchiveSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { ok: true, entries: parsed.data, overlapMs }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Splits archived keys into those still inside the overlap and the rest.
 * Fails safe: a retirement stamp more than a few minutes in the future is
 * treated as revoked, never as an extended overlap.
 */
export function partitionArchivedKeys(
  archive: Extract<WebhookKeyArchive, { ok: true }>,
  now: Date
): {
  overlap: PiggyvestArchivedWebhookKey[];
  replayOnly: PiggyvestArchivedWebhookKey[];
} {
  const overlap: PiggyvestArchivedWebhookKey[] = [];
  const replayOnly: PiggyvestArchivedWebhookKey[] = [];
  for (const entry of archive.entries) {
    const retiredAt = Date.parse(entry.retiredAt);
    const insideOverlap =
      retiredAt <= now.getTime() + CLOCK_SKEW_MS &&
      now.getTime() < retiredAt + archive.overlapMs;
    (insideOverlap ? overlap : replayOnly).push(entry);
  }
  return { overlap, replayOnly };
}

/**
 * Stable, non-secret label for a key that has no operator-assigned
 * version. An HMAC of a constant under the key itself reveals nothing the
 * signatures we already store do not, and never repeats the secret.
 */
export function derivePiggyvestKeyVersion(secret: string): string {
  const digest = createHmac('sha256', secret)
    .update('baci:piggyvest:webhook-key-version:v1')
    .digest('hex');
  return `k-${digest.slice(0, 16)}`;
}

/**
 * Which archived keys a verifier may use:
 * - `ingress`: a delivery arriving now. Only keys still inside their
 *   bounded overlap window authorise it.
 * - `replay`: bytes this deployment already accepted and stored. Keys past
 *   the overlap still count, because the rows were authentic when taken.
 */
export type WebhookKeyScope = 'ingress' | 'replay';

/**
 * Archived secrets belonging to exactly one key family. The primary
 * intakes (bank, custody, interest) re-verify with their own runtime keys,
 * so this is how a key moved into the archive at rotation keeps working for
 * the family it was issued for, and only that family: a key archived under
 * another family is never returned. An unreadable archive contributes
 * nothing (fail closed); ingress already reports it as misconfiguration.
 */
export function familyArchivedSecrets(
  family: PiggyvestArchivedWebhookKey['family'],
  env: NodeJS.ProcessEnv,
  now: Date,
  scope: WebhookKeyScope
): string[] {
  const archive = readWebhookKeyArchive(env);
  if (!archive.ok) return [];
  const { overlap, replayOnly } = partitionArchivedKeys(archive, now);
  const allowed = scope === 'replay' ? [...overlap, ...replayOnly] : overlap;
  return allowed
    .filter((entry) => entry.family === family)
    .map((entry) => entry.secret);
}

/**
 * Adds the family's archived secrets to an already-validated runtime
 * config's retained list. Applied after schema validation on purpose: the
 * schemas cap how many operator-configured retained keys exist, and the
 * archive has its own bound. The current key is never replaced.
 */
export function withFamilyArchivedSecrets<
  T extends { retainedWebhookSecrets?: string[] },
>(
  config: T,
  family: PiggyvestArchivedWebhookKey['family'],
  env: NodeJS.ProcessEnv,
  now: Date | number,
  scope: WebhookKeyScope
): T {
  const archived = familyArchivedSecrets(
    family,
    env,
    typeof now === 'number' ? new Date(now) : now,
    scope
  );
  if (archived.length === 0) return config;
  const retained = config.retainedWebhookSecrets ?? [];
  return {
    ...config,
    retainedWebhookSecrets: [
      ...retained,
      ...archived.filter((secret) => !retained.includes(secret)),
    ],
  } as T;
}
