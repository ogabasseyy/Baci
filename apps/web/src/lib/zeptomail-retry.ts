/**
 * ZeptoMail transport retry/fallback state machine.
 *
 * Extracted from `@/lib/zeptomail` (Boy Scout: that module is far past the
 * split rule): one sender-scoped retry loop plus the custom→platform
 * fallback orchestration, parameterized over sender resolution, token
 * resolution, and audit recording so this unit stays transport-only and
 * never reaches the credential authority directly (event-pipeline
 * boundary: only zeptomail.ts holds the env edge).
 */
import { resetTransportDispatchForFallback } from '@/lib/zeptomail-dispatch-reset';
import {
  ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE,
  zeptoMailRequest,
} from '@/lib/zeptomail-transport';

export interface SendFailure {
  message: string;
  code?: string;
  details?: unknown;
}

interface ZeptoMailError {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}

/**
 * Parse ZeptoMail error response
 */
export function parseError(error: unknown): SendFailure {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
    return { message: error.message, code };
  }

  const zeptoError = error as ZeptoMailError;
  if (zeptoError?.error) {
    return {
      message: zeptoError.error.message || 'Unknown ZeptoMail error',
      code: zeptoError.error.code,
      details: zeptoError.error.details,
    };
  }

  return { message: String(error) };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  retryableCodes: ['TM_5001', 'TM_5002', 'TM_5003'], // Server errors
};

/**
 * Check if error is retryable
 */
export function isRetryableError(errorCode?: string): boolean {
  if (!errorCode) return false;
  return (
    RETRY_CONFIG.retryableCodes.includes(errorCode) ||
    errorCode.startsWith('TM_5')
  );
}

export interface ZeptoMailTransportSender {
  address: string;
  name: string;
  isCustomDomain: boolean;
}

export interface ZeptoMailTransportContent {
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachments?: readonly unknown[];
  replyTo?: string;
  clientReference?: string;
}

export interface ZeptoMailTransportRun {
  sender: ZeptoMailTransportSender;
  content: ZeptoMailTransportContent;
  beforeTransportDispatch?: () => Promise<void>;
  resetTransportDispatch?: () => Promise<void>;
  resolvePlatformSender: () => { address: string; name: string };
  resolveToken: () => string;
  onAccepted: (info: {
    senderAddress: string;
    attemptCount: number;
    messageId: string;
  }) => Promise<void>;
}

export type ZeptoMailTransportOutcome =
  | { ok: { success: true; messageId: string } }
  | {
      failed: SendFailure;
      attempts: number;
      finalSenderAddress: string;
      deliveryOutcomeUnknown: boolean;
    };

/**
 * Run the retry loop for a single From identity, then fail over to the
 * platform sender once when a custom sender is rejected with a definite
 * outcome. Returns the success result, or the parsed failure with the
 * attempt/sender bookkeeping the caller records as a failed audit row.
 */
export async function runZeptoMailTransport(
  run: ZeptoMailTransportRun
): Promise<ZeptoMailTransportOutcome> {
  const {
    sender,
    content,
    beforeTransportDispatch,
    resetTransportDispatch,
    resolvePlatformSender,
    resolveToken,
    onAccepted,
  } = run;
  let transportDispatchMarked = false;

  // Run the retry loop for a single From identity. Returns the success result,
  // or the parsed failure when all attempts for this sender were exhausted.
  const dispatch = async (
    activeSender: { address: string; name: string },
    attemptOffset: number
  ): Promise<
    | { ok: { success: true; messageId: string } }
    | { failed: SendFailure; attempts: number }
  > => {
    let failure: SendFailure = { message: 'Unknown error' };
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      attemptsMade = attempt + 1;
      try {
        // Resolved inside the attempt's try block so a missing token
        // records a failed audit attempt (matching the legacy SDK
        // client's behavior) instead of throwing at the caller.
        const token = resolveToken();
        if (!transportDispatchMarked) {
          await beforeTransportDispatch?.();
          transportDispatchMarked = true;
        }
        const response = await zeptoMailRequest(
          'email',
          {
            from: { address: activeSender.address, name: activeSender.name },
            to: [
              {
                email_address: {
                  address: content.recipientEmail,
                  name: content.recipientName || content.recipientEmail,
                },
              },
            ],
            subject: content.subject,
            htmlbody: content.htmlContent,
            ...(content.textContent && { textbody: content.textContent }),
            ...(content.attachments?.length
              ? { attachments: content.attachments }
              : {}),
            // Δ-64: forward to ZeptoMail's documented `client_reference` only
            // when supplied; absent otherwise so unrelated calls don't have
            // to set it. The omission test asserts this.
            ...(content.clientReference && {
              client_reference: content.clientReference,
            }),
            ...(content.replyTo && {
              reply_to: [
                {
                  address: content.replyTo,
                  name: content.replyTo,
                },
              ],
            }),
          },
          token
        );

        const messageId = response?.request_id || 'unknown';
        await onAccepted({
          senderAddress: activeSender.address,
          attemptCount: attemptOffset + attempt + 1,
          messageId,
        });

        return {
          ok: {
            success: true,
            messageId,
          },
        };
      } catch (error) {
        failure = parseError(error);

        // Only retry on retryable errors
        if (
          attempt < RETRY_CONFIG.maxRetries &&
          isRetryableError(failure.code)
        ) {
          if (resetTransportDispatch) {
            try {
              await resetTransportDispatch();
            } catch {
              // A failed in-loop reset must not convert this definite
              // provider rejection into a thrown unknown: stop retrying and
              // report the definite failure so the sender clears or reclaims
              // the still-started marker on its bounded retry path.
              break;
            }
            transportDispatchMarked = false;
          }
          const delay = RETRY_CONFIG.baseDelayMs * 2 ** attempt;
          console.warn(
            `ZeptoMail retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} after ${delay}ms: ${failure.message}`
          );
          await sleep(delay);
          continue;
        }

        break;
      }
    }
    return { failed: failure, attempts: attemptsMade };
  };

  const primary = await dispatch(sender, 0);
  if ('ok' in primary) {
    return primary;
  }
  let lastError = primary.failed;
  let deliveryOutcomeUnknown =
    lastError.code === ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE;
  let totalAttempts = primary.attempts;
  let finalSenderAddress = sender.address;

  // Fail-open: a merchant custom sender may be rejected by ZeptoMail (stale or
  // not-yet-verified domain, restricted sender). Order confirmations must not be
  // lost to that, so retry once from the platform domain — mirroring the
  // auth-email hook, which also falls back to the platform sender.
  if (sender.isCustomDomain && !deliveryOutcomeUnknown) {
    const resetSucceeded = await resetTransportDispatchForFallback(
      resetTransportDispatch
    );
    if (resetSucceeded) {
      transportDispatchMarked = false;
      const platformSender = resolvePlatformSender();
      console.warn(
        `ZeptoMail custom sender rejected (${lastError.code ?? 'unknown'}); retrying from platform sender`
      );
      // Offset the fallback attempt counter by the primary's actual tries (not a
      // fixed maxRetries+1) so a fallback that succeeds on its first send records
      // attempt_count as primary.attempts + 1, not an inflated 5.
      const fallback = await dispatch(platformSender, primary.attempts);
      if ('ok' in fallback) {
        return fallback;
      }
      lastError = fallback.failed;
      deliveryOutcomeUnknown ||=
        lastError.code === ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE;
      totalAttempts += fallback.attempts;
      finalSenderAddress = platformSender.address;
    }
  }

  return {
    failed: lastError,
    attempts: totalAttempts,
    finalSenderAddress,
    deliveryOutcomeUnknown,
  };
}
