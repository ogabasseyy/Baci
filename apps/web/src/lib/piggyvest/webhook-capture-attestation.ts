/**
 * Operator attestation that the capture drain is installed and scheduled
 * (the same attest-after-installing-the-timer pattern the primary inboxes
 * use). It decides who owns the retry when processing does not complete
 * after a delivery was durably captured:
 *
 * - attested: the drain retries the stored row, so the receiver answers a
 *   deferred 200 and the provider stops redelivering;
 * - not attested: the provider's own redeliveries are the only retry, so
 *   the receiver keeps answering 503 and the stored row waits.
 *
 * Only the exact string 'true' counts. Anything else (unset, empty, 'TRUE',
 * '1') fails toward the provider retry. Read at call time, never at module
 * load, so flipping the variable takes effect on the next request.
 */
export const PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV =
  'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED';

export function isPiggyvestCaptureDrainScheduled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[PIGGYVEST_CAPTURE_DRAIN_ATTESTATION_ENV] === 'true';
}

/**
 * Worker-host switch for the capture drain itself (set in the worker
 * host's environment, never on the web app). Only the exact string 'true'
 * enables it; anything else keeps the drain from reading configuration or
 * opening a database connection.
 */
export const PIGGYVEST_CAPTURE_DRAIN_ENABLED_ENV =
  'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_ENABLED';

export function isPiggyvestCaptureDrainEnabled(
  env: NodeJS.ProcessEnv
): boolean {
  return env[PIGGYVEST_CAPTURE_DRAIN_ENABLED_ENV] === 'true';
}

/** Optional legacy replay; dark unless explicitly enabled on the worker. */
export const PIGGYVEST_CAPTURE_LEGACY_REPLAY_ENV =
  'PIGGYVEST_WEBHOOK_CAPTURE_LEGACY_REPLAY_ENABLED';

export function isPiggyvestCaptureLegacyReplayEnabled(
  env: NodeJS.ProcessEnv
): boolean {
  return env[PIGGYVEST_CAPTURE_LEGACY_REPLAY_ENV] === 'true';
}
