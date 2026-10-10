/**
 * ZeptoMail send-budget policy: worst-case sizing for the transport retry
 * loop, so deadline-driven callers can admit a send only when it fits.
 * The retry counts live here as the single source of truth; zeptomail.ts
 * builds its runtime retry config from them.
 */
export const ZEPTOMAIL_MAX_RETRIES = 3;
export const ZEPTOMAIL_RETRY_BASE_DELAY_MS = 1000;

// One transport attempt worst case: mirrors ZEPTOMAIL_REQUEST_TIMEOUT_MS
// in zeptomail-transport.ts; keep identical.
const TRANSPORT_ATTEMPT_WORST_MS = 30_000;
const AUDIT_WRITE_MARGIN_MS = 8_000;
// Callers abort the send 10s before their deadline (signal + deadline
// race); admission budgets must leave that buffer on top of the loop.
const SEND_CUTOFF_BUFFER_MS = 10_000;

/** Clamp a per-sender attempt cap into the configured retry loop. */
export function clampZeptomailAttemptsPerSender(
  maxAttemptsPerSender: number
): number {
  return Math.max(1, Math.min(maxAttemptsPerSender, ZEPTOMAIL_MAX_RETRIES + 1));
}

/** Worst-case wall time for one sender's retry loop. */
export function senderLoopWorstMs(maxAttempts: number): number {
  const attempts = clampZeptomailAttemptsPerSender(maxAttempts);
  let backoffMs = 0;
  for (let i = 0; i < attempts - 1; i++) {
    backoffMs += ZEPTOMAIL_RETRY_BASE_DELAY_MS * 2 ** i;
  }
  return (
    attempts * TRANSPORT_ATTEMPT_WORST_MS + backoffMs + AUDIT_WRITE_MARGIN_MS
  );
}

/**
 * Budget a send must start with to guarantee completion before its
 * cutoff: the primary sender's worst retry loop plus the 10s abort
 * buffer. The platform-sender fallback needs no extra reservation —
 * under a deadline it is a single shot that declines unless one
 * attempt fits the remaining budget, so a send admitted with this
 * budget always finishes before the cutoff.
 */
export function zeptomailSendAdmissionBudgetMs(
  maxAttemptsPerSender: number = ZEPTOMAIL_MAX_RETRIES + 1
): number {
  return senderLoopWorstMs(maxAttemptsPerSender) + SEND_CUTOFF_BUFFER_MS;
}

export interface ZeptomailFallbackAdmission {
  fallbackAttempts: number;
  fallbackBudgetMs: number | undefined;
  fallbackFits: boolean;
  fallbackWorstMs: number;
}

/**
 * Admit the platform-sender fallback. Without a deadline the fallback
 * runs the full per-sender loop; under a deadline the primary loop
 * already spent the retry budget, so the fallback gets a single shot
 * from the healthy platform domain (the sweep retries transient
 * failures next tick) and runs whenever that single attempt fits.
 * Gating on another full loop would skip the fallback on every retry
 * — admission reserves exactly one loop plus the cutoff buffer —
 * exhausting the row solely because the merchant sender is stale.
 * Skipping on a truly exhausted budget still avoids aborting mid-send
 * and stranding the row as delivery_uncertain instead of a clean
 * retryable failure. Pass the remaining budget (deadline minus now);
 * omit it when the caller set no fallback deadline.
 */
/**
 * Admit the platform-sender fallback from the caller's absolute
 * deadline: converts the epoch-ms cutoff to a remaining budget and
 * resolves admission in one call, so the send path passes its
 * deadline through instead of spreading deadline math inline.
 */
export function admitZeptomailPlatformFallback({
  attemptsPerSender,
  fallbackDeadlineMs,
  nowMs = Date.now(),
}: {
  attemptsPerSender: number;
  fallbackDeadlineMs?: number;
  nowMs?: number;
}): ZeptomailFallbackAdmission {
  return resolveZeptomailFallbackAdmission({
    attemptsPerSender,
    ...(fallbackDeadlineMs !== undefined && {
      remainingBudgetMs: fallbackDeadlineMs - nowMs,
    }),
  });
}

export function resolveZeptomailFallbackAdmission({
  attemptsPerSender,
  remainingBudgetMs,
}: {
  attemptsPerSender: number;
  remainingBudgetMs?: number;
}): ZeptomailFallbackAdmission {
  const fallbackAttempts =
    remainingBudgetMs === undefined ? attemptsPerSender : 1;
  const fallbackWorstMs = senderLoopWorstMs(fallbackAttempts);
  const fallbackFits =
    remainingBudgetMs === undefined || remainingBudgetMs >= fallbackWorstMs;
  return {
    fallbackAttempts,
    fallbackBudgetMs: remainingBudgetMs,
    fallbackFits,
    fallbackWorstMs,
  };
}
