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

/** Worst-case wall time for one sender's retry loop. */
export function senderLoopWorstMs(maxAttempts: number): number {
  const attempts = Math.max(
    1,
    Math.min(maxAttempts, ZEPTOMAIL_MAX_RETRIES + 1)
  );
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
 * buffer. The platform-sender fallback needs no extra reservation — it
 * declines unless its own loop fits the remaining budget, so a send
 * admitted with this budget always finishes before the cutoff.
 */
export function zeptomailSendAdmissionBudgetMs(
  maxAttemptsPerSender: number = ZEPTOMAIL_MAX_RETRIES + 1
): number {
  return senderLoopWorstMs(maxAttemptsPerSender) + SEND_CUTOFF_BUFFER_MS;
}
