import { waitUntil } from '@vercel/functions';
import type {
  PiggyvestWebhookAlertCode,
  PiggyvestWebhookAlertDetail,
} from '@/lib/piggyvest/webhook-alerts';
import { deterministicEventUuid } from '@/lib/posthog/deterministic-event-uuid';
import { captureServerEvent } from '@/lib/posthog/server';

/**
 * Server-side PostHog page for PiggyVest money alerts (R5). The console line
 * written by `emitPiggyvestWebhookAlert` stays the primary signal; this is a
 * second, best-effort channel an owner can alert on in PostHog.
 *
 * Contract:
 * - Properties are an explicit allowlist (code, key version, reason, capture,
 *   event type, attempts, operation) plus the deployment label. Request
 *   bodies, signatures, key material and customer data are never sent, and
 *   identifier values that are not plain identifiers are dropped.
 * - Fire-and-forget: the send is bounded by a timeout, never throws and never
 *   rejects, so it cannot change any reply.
 * - Deduped per capture (or operation) and code within this process, with a
 *   deterministic event id so cross-instance copies share one id. PostHog
 *   only drops a copy whose timestamp also matches, so another instance may
 *   still page once. An alert without either id repeats at most once per
 *   window. A failed or timed-out send releases its slot so the next
 *   occurrence can retry.
 */
export const PIGGYVEST_MONEY_ALERT_EVENT = 'piggyvest_money_alert';
export const PIGGYVEST_MONEY_ALERT_TIMEOUT_MS = 2_000;

const UNKEYED_WINDOW_MS = 10 * 60_000;
const DEDUPE_CAPACITY = 512;
const MAX_REASON_LENGTH = 120;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Phone, account and card numbers are long digit runs, sometimes grouped by
// single spaces or dashes; no alert needs one (dates are filtered too).
const LONG_DIGIT_RUN = /\d(?:[\s-]?\d){6,}/g;
const FILTERED = '[Filtered]';

export interface PiggyvestMoneyAlertProperties {
  code: PiggyvestWebhookAlertCode;
  deployment_environment: string;
  key_version?: string;
  reason?: string;
  capture_id?: string;
  event_type?: string;
  attempts?: number;
  operation_id?: string;
}

export type PiggyvestMoneyAlertOutcome = 'sent' | 'duplicate' | 'failed';

export interface PiggyvestMoneyAlertDeps {
  capture: (
    event: string,
    properties: PiggyvestMoneyAlertProperties,
    distinctId: undefined,
    uuid: string
  ) => Promise<boolean>;
  /** Keeps a serverless invocation alive until the send settles. */
  keepAlive: (pending: Promise<unknown>) => void;
  now: () => number;
  env: Record<string, string | undefined>;
  timeoutMs: number;
}

type AlertEnv = PiggyvestMoneyAlertDeps['env'];

function identifier(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value)
    ? value
    : undefined;
}

function scrubbedReason(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .replace(EMAIL_VALUE, FILTERED)
    .replace(LONG_DIGIT_RUN, FILTERED)
    .slice(0, MAX_REASON_LENGTH);
}

export function buildPiggyvestMoneyAlertProperties(
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail,
  env: AlertEnv = process.env
): PiggyvestMoneyAlertProperties {
  const properties: PiggyvestMoneyAlertProperties = {
    code,
    deployment_environment: env.VERCEL_ENV || env.NODE_ENV || 'development',
  };
  const keyVersion = identifier(detail.keyVersion);
  if (keyVersion) properties.key_version = keyVersion;
  const reason = scrubbedReason(detail.reason);
  if (reason) properties.reason = reason;
  const captureId = identifier(detail.captureId);
  if (captureId) properties.capture_id = captureId;
  const eventType = identifier(detail.eventType);
  if (eventType) properties.event_type = eventType;
  const { attempts } = detail;
  if (typeof attempts === 'number' && Number.isSafeInteger(attempts))
    if (attempts >= 0) properties.attempts = attempts;
  const operationId = identifier(detail.operationId);
  if (operationId) properties.operation_id = operationId;
  return properties;
}

function dedupeKey(
  properties: PiggyvestMoneyAlertProperties,
  now: number
): string {
  const { code } = properties;
  if (properties.capture_id) return `${code}:capture:${properties.capture_id}`;
  if (properties.operation_id)
    return `${code}:operation:${properties.operation_id}`;
  const window = Math.floor(now / UNKEYED_WINDOW_MS);
  return `${code}:key:${properties.key_version ?? '-'}:window:${window}`;
}

async function deliver(
  deps: PiggyvestMoneyAlertDeps,
  properties: PiggyvestMoneyAlertProperties,
  key: string
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The capture keeps its own rejection handler, so a send that fails
    // after the timeout has won the race still settles quietly.
    const captured = deps
      .capture(
        PIGGYVEST_MONEY_ALERT_EVENT,
        properties,
        undefined,
        deterministicEventUuid(`${PIGGYVEST_MONEY_ALERT_EVENT}:${key}`)
      )
      .catch(() => false);
    return await Promise.race([
      captured,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), deps.timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_DEPS: PiggyvestMoneyAlertDeps = {
  capture: (event, properties, distinctId, uuid) =>
    captureServerEvent(event, { ...properties }, distinctId, uuid),
  keepAlive: (pending) => {
    waitUntil(pending);
  },
  now: () => Date.now(),
  env: process.env,
  timeoutMs: PIGGYVEST_MONEY_ALERT_TIMEOUT_MS,
};

export function createPiggyvestMoneyAlertSender(
  overrides: Partial<PiggyvestMoneyAlertDeps> = {}
): (
  code: PiggyvestWebhookAlertCode,
  detail: PiggyvestWebhookAlertDetail
) => Promise<PiggyvestMoneyAlertOutcome> {
  const deps: PiggyvestMoneyAlertDeps = { ...DEFAULT_DEPS, ...overrides };
  // Insertion-ordered, so the oldest key is evicted first.
  const claimed = new Set<string>();

  return (code, detail) => {
    let pending: Promise<PiggyvestMoneyAlertOutcome>;
    try {
      const properties = buildPiggyvestMoneyAlertProperties(
        code,
        detail,
        deps.env
      );
      const key = dedupeKey(properties, deps.now());
      if (claimed.has(key)) return Promise.resolve('duplicate');
      claimed.add(key);
      if (claimed.size > DEDUPE_CAPACITY) {
        const oldest = claimed.values().next().value;
        if (oldest !== undefined) claimed.delete(oldest);
      }
      pending = deliver(deps, properties, key).then((sent) => {
        if (sent) return 'sent';
        claimed.delete(key);
        return 'failed';
      });
    } catch {
      return Promise.resolve('failed');
    }
    try {
      deps.keepAlive(pending);
    } catch {
      // Outside a request context there is nothing to extend.
    }
    return pending;
  };
}

/** The process-wide sender `emitPiggyvestWebhookAlert` pages through. */
export const sendPiggyvestMoneyAlert = createPiggyvestMoneyAlertSender();
