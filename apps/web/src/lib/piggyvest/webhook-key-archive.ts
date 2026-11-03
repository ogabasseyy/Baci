import 'server-only';
import { createHmac } from 'node:crypto';
import {
  MAX_ARCHIVED_KEYS_PER_FAMILY,
  type PiggyvestArchivedWebhookKey,
  piggyvestWebhookKeyArchiveSchema,
} from '@/schemas/piggyvest/webhook-key-archive';

export const DEFAULT_WEBHOOK_KEY_OVERLAP_HOURS = 72;
export const MAX_WEBHOOK_KEY_OVERLAP_HOURS = 168;
const HOUR_MS = 3_600_000;
// A retirement stamp meaningfully in the future is an operator typo; letting
// it stand would keep a key accepted far past any bounded overlap.
const CLOCK_SKEW_MS = 5 * 60_000;

export type WebhookKeyArchiveIssue =
  | 'UNREADABLE'
  | 'FAMILY_CAP_EXCEEDED'
  | 'INVALID';

export type WebhookKeyArchive =
  | { ok: true; entries: PiggyvestArchivedWebhookKey[]; overlapMs: number }
  | { ok: false; reason: WebhookKeyArchiveIssue };

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
    if (parsed.success) return { ok: true, entries: parsed.data, overlapMs };
    const overCap = parsed.error.issues.some((issue) =>
      issue.message.includes('archived keys per family')
    );
    return { ok: false, reason: overCap ? 'FAMILY_CAP_EXCEEDED' : 'INVALID' };
  } catch {
    return { ok: false, reason: 'UNREADABLE' };
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
 * The per-family bound is owned by the archive config schema (see
 * MAX_ARCHIVED_KEYS_PER_FAMILY): an archive over it is rejected whole, so
 * every layer sees the same in-scope keys and nothing is truncated.
 */
export const MAX_FAMILY_ARCHIVED_SECRETS = MAX_ARCHIVED_KEYS_PER_FAMILY;

/**
 * Archived secrets belonging to exactly one key family, in scope, newest
 * retirement first (at most the schema cap, never truncated). The primary
 * intakes (bank, custody, interest) and their workers re-verify with their
 * own runtime keys, so this is how a key moved into the archive at
 * rotation keeps working for the family it was issued for, and only that
 * family: a key archived under another family is never returned. An
 * unreadable archive contributes nothing (fail closed); ingress already
 * reports it as misconfiguration.
 *
 * The result is a separate, derived list. It is never written into the
 * operator-configured retained list, which is validated with the family's
 * schema caps by the runtime readers and again by every constructor.
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
    .sort((a, b) => Date.parse(b.retiredAt) - Date.parse(a.retiredAt))
    .map((entry) => entry.secret);
}

/**
 * Every secret a verifier may try: the operator-validated current and
 * retained keys followed by the separate derived archive list. Pure and
 * bounded; neither input is modified.
 */
export function acceptedWebhookSecrets(
  config: {
    webhookSecret?: unknown;
    retainedWebhookSecrets?: readonly unknown[];
  },
  archived: readonly string[]
): string[] {
  const usable = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;
  return [
    ...new Set([
      ...[
        config.webhookSecret,
        ...(config.retainedWebhookSecrets ?? []),
      ].filter(usable),
      ...archived.filter(usable),
    ]),
  ];
}
