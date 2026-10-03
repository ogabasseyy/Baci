import { getZeptoMailFromDomain, getZeptoMailToken } from '@/env';
import { getActiveMerchantSendingDomain } from '@/lib/merchant-sending-domain';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  clampZeptomailAttemptsPerSender,
  resolveZeptomailFallbackAdmission,
  ZEPTOMAIL_MAX_RETRIES,
  ZEPTOMAIL_RETRY_BASE_DELAY_MS,
} from '@/lib/zeptomail-send-budget';
import {
  ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE,
  zeptoMailRequest,
} from '@/lib/zeptomail-transport';

export { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

/**
 * Resolve the ZeptoMail API token. Called inside each send attempt's
 * try block so a missing token records a failed audit attempt (matching
 * the legacy SDK client's behavior) instead of throwing at the caller.
 */
function getRequiredToken(): string {
  const token = getZeptoMailToken();
  if (!token) {
    throw new Error('ZEPTOMAIL_TOKEN environment variable is not configured');
  }
  return token;
}

const DEFAULT_FROM_DOMAIN = getZeptoMailFromDomain();

// Email type to sender address mapping
export type EmailType =
  | 'orders'
  | 'welcome'
  | 'notifications'
  | 'team'
  | 'newsletter'
  | 'noreply';

const EMAIL_SENDERS: Record<EmailType, { prefix: string; name: string }> = {
  orders: { prefix: 'orders', name: 'Baci Orders' },
  welcome: { prefix: 'hello', name: 'Baci' },
  notifications: { prefix: 'notifications', name: 'Baci Notifications' },
  team: { prefix: 'team', name: 'Baci Team' },
  newsletter: { prefix: 'newsletter', name: 'Baci Newsletter' },
  noreply: { prefix: 'noreply', name: 'Baci' },
};

function getSenderAddress(
  emailType: EmailType = 'noreply',
  customName?: string
): { address: string; name: string } {
  const sender = EMAIL_SENDERS[emailType] || EMAIL_SENDERS.noreply;
  return {
    address: `${sender.prefix}@${DEFAULT_FROM_DOMAIN}`,
    name: customName || sender.name,
  };
}

// Customer-facing email types that should send from the merchant's own verified
// sending domain (e.g. orders@ogabassey.com) when one is configured. Platform→
// merchant mail (settlement, sales summaries — sent as `noreply`) deliberately
// stays on the platform domain even though it carries a merchantId.
const MERCHANT_DOMAIN_EMAIL_TYPES: ReadonlySet<EmailType> = new Set(['orders']);

/**
 * Resolve the From address for a send, preferring the merchant's verified
 * custom sending domain for customer-facing mail and falling back to the
 * platform domain otherwise. Keeps the per-type prefix (orders@, etc.) and the
 * resolved display name; only the domain swaps.
 */
async function resolveSenderAddress(
  emailType: EmailType,
  customName: string | undefined,
  merchantId: string | null | undefined
): Promise<{ address: string; name: string; isCustomDomain: boolean }> {
  const base = {
    ...getSenderAddress(emailType, customName),
    isCustomDomain: false,
  };

  if (!merchantId || !MERCHANT_DOMAIN_EMAIL_TYPES.has(emailType)) {
    return base;
  }

  const customDomain = await getActiveMerchantSendingDomain(merchantId);
  if (!customDomain) {
    return base;
  }

  const prefix = (EMAIL_SENDERS[emailType] || EMAIL_SENDERS.noreply).prefix;
  return {
    address: `${prefix}@${customDomain}`,
    name: base.name,
    isCustomDomain: true,
  };
}

/**
 * Validate email address format
 * Uses length limit and simpler pattern to prevent ReDoS
 */
function isValidEmail(email: string): boolean {
  // Limit length to prevent ReDoS attacks
  if (!email || email.length > 254) return false;

  // Simple email validation - avoids complex patterns that can cause backtracking
  const atIndex = email.indexOf('@');
  if (atIndex < 1 || atIndex === email.length - 1) return false;

  const dotIndex = email.lastIndexOf('.');
  if (dotIndex < atIndex + 2 || dotIndex === email.length - 1) return false;

  // No whitespace allowed
  if (/\s/.test(email)) return false;

  return true;
}

function normalizeRuntimeRecipientEmail(email: unknown): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const trimmedEmail = email.trim();
  return trimmedEmail.length > 0 ? trimmedEmail : null;
}

interface SendEmailParams {
  signal?: AbortSignal;
  to: string;
  toName?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  emailType?: EmailType;
  fromName?: string;
  auditContext?: EmailAuditContext;
  // When set (or via auditContext.merchantId), customer-facing mail is sent
  // from this merchant's verified custom sending domain if one is configured.
  merchantId?: string | null;
  // Δ-64 (A1): forwarded to ZeptoMail's documented `client_reference`
  // field. The outbox helper sets this to `order:<id>:paid_email` so we
  // have a server-side audit trail showing which sends actually went out
  // — used to bound the residual "sent then crashed before mark-completed"
  // duplicate window. Not an idempotency key (ZeptoMail does not support
  // one); idempotency lives in the payment_side_effects claim row.
  clientReference?: string;
  beforeTransportDispatch?: () => Promise<void>;
  resetTransportDispatch?: () => Promise<void>;
  // Absolute epoch-ms cutoff for the platform-sender fallback: when set
  // the fallback is a single shot (the primary loop already spent the
  // retry budget), skipped unless that one attempt fits, so a cron
  // drain keeps a retryable row instead of stranding it mid-send as
  // permanently delivery_uncertain.
  fallbackDeadlineMs?: number;
  // Cap transport attempts per sender (default: full retry loop). Tight
  // cron phases pass 1 and let the next tick retry instead of burning
  // the phase on in-process retries.
  maxAttemptsPerSender?: number;
}

interface EmailAttachment {
  name: string;
  content: string;
  mime_type: string;
}

interface SendEmailWithTemplateParams {
  to: string;
  toName?: string;
  templateKey: string;
  mergeInfo: Record<string, string>;
  replyTo?: string;
  emailType?: EmailType;
  fromName?: string;
  auditContext?: EmailAuditContext;
  merchantId?: string | null;
}

interface EmailResult {
  deliveryOutcome?: 'unknown';
  success: boolean;
  messageId?: string;
  error?: string;
  errorCode?: string;
  errorDetails?: unknown;
}

interface EmailAuditContext {
  merchantId?: string | null;
  orderId?: string | null;
  customerId?: string | null;
  metadata?: Record<string, unknown>;
}

interface EmailAttemptRow {
  transport_type: 'html' | 'template' | 'batch_template';
  status: 'pending' | 'accepted' | 'failed';
  email_type: EmailType;
  recipient_email: string;
  recipient_name?: string;
  from_address: string;
  from_name: string;
  reply_to?: string;
  subject?: string;
  template_key?: string;
  attempt_count?: number;
  merchant_id?: string | null;
  order_id?: string | null;
  customer_id?: string | null;
  metadata?: Record<string, unknown>;
  provider_message_id?: string;
  provider_error_code?: string;
  provider_error_message?: string;
  provider_error_details?: unknown;
}

interface ZeptoMailError {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}

type EmailAttemptInsert = EmailAttemptRow & {
  id?: string;
};

interface SendFailure {
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Parse ZeptoMail error response
 */
function parseError(error: unknown): SendFailure {
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

function buildAuditMetadata(
  context: EmailAuditContext | undefined,
  metadata?: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(context?.metadata ?? {}),
    ...(metadata ?? {}),
  };
}

function getAuditClient() {
  try {
    return createAdminClient();
  } catch (error) {
    console.error('Email audit client unavailable:', error);
    return null;
  }
}

async function insertEmailAttempts(
  attempts: EmailAttemptInsert[]
): Promise<string[]> {
  if (attempts.length === 0) {
    return [];
  }

  const supabase = getAuditClient();
  if (!supabase) {
    return [];
  }

  // Audit writes must never throw: callers treat a throw from
  // sendEmail as pre-dispatch (safe to retry), so a transport throw
  // here — after the provider already accepted — would either
  // duplicate the send or corrupt the outcome. Resolve every
  // failure and let the send result speak for itself.
  try {
    const { data, error } = await supabase
      .from('email_send_attempts')
      .insert(attempts)
      .select('id');

    if (error) {
      console.error('Failed to log email attempts:', error);
      return [];
    }

    return (data ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === 'string');
  } catch (transportError) {
    console.error('Failed to log email attempts:', transportError);
    return [];
  }
}

async function updateEmailAttempts(
  ids: string[],
  patch: Partial<EmailAttemptInsert>
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const supabase = getAuditClient();
  if (!supabase) {
    return;
  }

  // Never throws, for the same dispatch-boundary reason as the
  // insert above: the accepted-audit call runs after the provider
  // already took the message.
  try {
    const { error } = await supabase
      .from('email_send_attempts')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .in('id', ids);

    if (error) {
      console.error('Failed to update email attempts:', error);
    }
  } catch (transportError) {
    console.error('Failed to update email attempts:', transportError);
  }
}

function createAuditAttempt(params: {
  transportType: EmailAttemptRow['transport_type'];
  emailType: EmailType;
  recipientEmail: string;
  recipientName?: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
  subject?: string;
  templateKey?: string;
  auditContext?: EmailAuditContext;
  metadata?: Record<string, unknown>;
  status?: EmailAttemptRow['status'];
  providerErrorMessage?: string;
}): EmailAttemptInsert {
  return {
    transport_type: params.transportType,
    status: params.status ?? 'pending',
    email_type: params.emailType,
    recipient_email: params.recipientEmail,
    recipient_name: params.recipientName,
    from_address: params.fromAddress,
    from_name: params.fromName,
    reply_to: params.replyTo,
    subject: params.subject,
    template_key: params.templateKey,
    merchant_id: params.auditContext?.merchantId ?? null,
    order_id: params.auditContext?.orderId ?? null,
    customer_id: params.auditContext?.customerId ?? null,
    metadata: buildAuditMetadata(params.auditContext, params.metadata),
    ...(params.providerErrorMessage
      ? { provider_error_message: params.providerErrorMessage }
      : {}),
  };
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: ZEPTOMAIL_MAX_RETRIES,
  baseDelayMs: ZEPTOMAIL_RETRY_BASE_DELAY_MS,
  retryableCodes: ['TM_5001', 'TM_5002', 'TM_5003'], // Server errors
};

/**
 * Check if error is retryable
 */
function isRetryableError(errorCode?: string): boolean {
  if (!errorCode) return false;
  return (
    RETRY_CONFIG.retryableCodes.includes(errorCode) ||
    errorCode.startsWith('TM_5')
  );
}

/**
 * Send transactional email via ZeptoMail with HTML content.
 *
 * Dispatch boundary: every outcome reached after the first transport
 * attempt resolves as an EmailResult — the per-attempt loop catches
 * transport throws and the audit writes never throw — so a throw from
 * this function means no dispatch happened (sender resolution, or a
 * caller-supplied transport callback) and the caller may safely
 * retry. The one exception is a caller-supplied
 * beforeTransportDispatch/resetTransportDispatch callback that throws
 * after a send: keep such callbacks infallible or resolve their
 * errors.
 */
export async function sendEmail({
  signal,
  to,
  toName,
  subject,
  htmlContent,
  textContent,
  attachments,
  replyTo,
  emailType = 'noreply',
  fromName,
  auditContext,
  merchantId,
  clientReference,
  beforeTransportDispatch,
  resetTransportDispatch,
  fallbackDeadlineMs,
  maxAttemptsPerSender = RETRY_CONFIG.maxRetries + 1,
}: SendEmailParams): Promise<EmailResult> {
  const sender = await resolveSenderAddress(
    emailType,
    fromName,
    merchantId ?? auditContext?.merchantId
  );
  const recipientEmail = normalizeRuntimeRecipientEmail(to);

  // Validate email
  if (!recipientEmail) {
    return {
      success: false,
      error: 'Invalid email address',
    };
  }

  if (!isValidEmail(recipientEmail)) {
    await insertEmailAttempts([
      createAuditAttempt({
        transportType: 'html',
        emailType,
        recipientEmail,
        recipientName: toName,
        fromAddress: sender.address,
        fromName: sender.name,
        replyTo,
        subject,
        auditContext,
        status: 'failed',
        providerErrorMessage: `Invalid email address: ${recipientEmail}`,
      }),
    ]);

    return {
      success: false,
      error: `Invalid email address: ${recipientEmail}`,
    };
  }

  if (replyTo && !isValidEmail(replyTo)) {
    await insertEmailAttempts([
      createAuditAttempt({
        transportType: 'html',
        emailType,
        recipientEmail,
        recipientName: toName,
        fromAddress: sender.address,
        fromName: sender.name,
        replyTo,
        subject,
        auditContext,
        status: 'failed',
        providerErrorMessage: `Invalid reply-to email address: ${replyTo}`,
      }),
    ]);

    return {
      success: false,
      error: `Invalid reply-to email address: ${replyTo}`,
    };
  }

  const auditIds = await insertEmailAttempts([
    createAuditAttempt({
      transportType: 'html',
      emailType,
      recipientEmail,
      recipientName: toName,
      fromAddress: sender.address,
      fromName: sender.name,
      replyTo,
      subject,
      auditContext,
    }),
  ]);
  let transportDispatchMarked = false;

  // Run the retry loop for a single From identity. Returns the success result,
  // or the parsed failure when all attempts for this sender were exhausted.
  const attemptsPerSender =
    clampZeptomailAttemptsPerSender(maxAttemptsPerSender);
  const dispatch = async (
    activeSender: { address: string; name: string },
    attemptOffset: number,
    maxAttempts: number = attemptsPerSender
  ): Promise<
    { ok: EmailResult } | { failed: SendFailure; attempts: number }
  > => {
    let failure: SendFailure = { message: 'Unknown error' };
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      try {
        const token = getRequiredToken();
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
                  address: recipientEmail,
                  name: toName || recipientEmail,
                },
              },
            ],
            subject,
            htmlbody: htmlContent,
            ...(textContent && { textbody: textContent }),
            ...(attachments?.length ? { attachments } : {}),
            // Δ-64: forward to ZeptoMail's documented `client_reference` only
            // when supplied; absent otherwise so unrelated calls don't have
            // to set it. The omission test asserts this.
            ...(clientReference && { client_reference: clientReference }),
            ...(replyTo && {
              reply_to: [
                {
                  address: replyTo,
                  name: replyTo,
                },
              ],
            }),
          },
          token,
          signal
        );

        await updateEmailAttempts(auditIds, {
          status: 'accepted',
          provider_message_id: response?.request_id || 'unknown',
          attempt_count: attemptOffset + attempt + 1,
          from_address: activeSender.address,
        });

        return {
          ok: {
            success: true,
            messageId: response?.request_id || 'unknown',
          },
        };
      } catch (error) {
        failure = parseError(error);

        // Only retry on retryable errors
        if (attempt + 1 < maxAttempts && isRetryableError(failure.code)) {
          if (resetTransportDispatch) {
            await resetTransportDispatch();
            transportDispatchMarked = false;
          }
          const delay = RETRY_CONFIG.baseDelayMs * 2 ** attempt;
          console.warn(
            `ZeptoMail retry ${attempt + 1}/${attemptsPerSender - 1} after ${delay}ms: ${failure.message}`
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
    return primary.ok;
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
  const { fallbackAttempts, fallbackBudgetMs, fallbackFits, fallbackWorstMs } =
    resolveZeptomailFallbackAdmission({
      attemptsPerSender,
      ...(fallbackDeadlineMs !== undefined && {
        remainingBudgetMs: fallbackDeadlineMs - Date.now(),
      }),
    });
  if (fallbackBudgetMs !== undefined && !fallbackFits) {
    console.warn(
      `ZeptoMail skipping platform-sender fallback: ${String(fallbackBudgetMs)}ms remain, ${String(fallbackWorstMs)}ms required`
    );
  }
  if (sender.isCustomDomain && !deliveryOutcomeUnknown && fallbackFits) {
    await resetTransportDispatch?.();
    transportDispatchMarked = false;
    const platformSender = getSenderAddress(emailType, fromName);
    console.warn(
      `ZeptoMail custom sender rejected (${lastError.code ?? 'unknown'}); retrying from platform sender`
    );
    // Offset the fallback attempt counter by the primary's actual tries (not a
    // fixed maxRetries+1) so a fallback that succeeds on its first send records
    // attempt_count as primary.attempts + 1, not an inflated 5.
    const fallback = await dispatch(
      platformSender,
      primary.attempts,
      fallbackAttempts
    );
    if ('ok' in fallback) {
      return fallback.ok;
    }
    lastError = fallback.failed;
    deliveryOutcomeUnknown ||=
      lastError.code === ZEPTOMAIL_DELIVERY_OUTCOME_UNKNOWN_CODE;
    totalAttempts += fallback.attempts;
    finalSenderAddress = platformSender.address;
  }

  console.error('ZeptoMail email error:', JSON.stringify(lastError));
  await updateEmailAttempts(auditIds, {
    status: 'failed',
    attempt_count: totalAttempts,
    from_address: finalSenderAddress,
    provider_error_code: lastError.code,
    provider_error_message: lastError.message || 'Unknown error',
    provider_error_details: lastError.details,
  });
  return {
    success: false,
    ...(deliveryOutcomeUnknown ? { deliveryOutcome: 'unknown' as const } : {}),
    error: lastError.message || 'Unknown error',
    errorCode: lastError.code,
    errorDetails: lastError.details,
  };
}

/**
 * Send transactional email via ZeptoMail using a template
 */
export async function sendEmailWithTemplate({
  to,
  toName,
  templateKey,
  mergeInfo,
  replyTo,
  emailType = 'noreply',
  fromName,
  auditContext,
  merchantId,
}: SendEmailWithTemplateParams): Promise<EmailResult> {
  const sender = await resolveSenderAddress(
    emailType,
    fromName,
    merchantId ?? auditContext?.merchantId
  );
  const recipientEmail = normalizeRuntimeRecipientEmail(to);

  // Validate email
  if (!recipientEmail) {
    return {
      success: false,
      error: 'Invalid email address',
    };
  }

  if (!isValidEmail(recipientEmail)) {
    await insertEmailAttempts([
      createAuditAttempt({
        transportType: 'template',
        emailType,
        recipientEmail,
        recipientName: toName,
        fromAddress: sender.address,
        fromName: sender.name,
        replyTo,
        templateKey,
        auditContext,
        status: 'failed',
        providerErrorMessage: `Invalid email address: ${recipientEmail}`,
      }),
    ]);

    return {
      success: false,
      error: `Invalid email address: ${recipientEmail}`,
    };
  }

  if (replyTo && !isValidEmail(replyTo)) {
    await insertEmailAttempts([
      createAuditAttempt({
        transportType: 'template',
        emailType,
        recipientEmail,
        recipientName: toName,
        fromAddress: sender.address,
        fromName: sender.name,
        replyTo,
        templateKey,
        auditContext,
        status: 'failed',
        providerErrorMessage: `Invalid reply-to email address: ${replyTo}`,
      }),
    ]);

    return {
      success: false,
      error: `Invalid reply-to email address: ${replyTo}`,
    };
  }

  let lastError: { message: string; code?: string; details?: unknown } | null =
    null;
  const auditIds = await insertEmailAttempts([
    createAuditAttempt({
      transportType: 'template',
      emailType,
      recipientEmail,
      recipientName: toName,
      fromAddress: sender.address,
      fromName: sender.name,
      replyTo,
      templateKey,
      auditContext,
      metadata: { mergeInfoKeys: Object.keys(mergeInfo) },
    }),
  ]);

  // Run the retry loop for a single From identity. Returns success, or the
  // parsed failure plus the number of attempts made for this sender.
  const dispatchTemplate = async (
    activeSender: { address: string; name: string },
    attemptOffset: number
  ): Promise<
    | { ok: EmailResult }
    | {
        failed: { message: string; code?: string; details?: unknown };
        attempts: number;
      }
  > => {
    let failure: { message: string; code?: string; details?: unknown } = {
      message: 'Unknown error',
    };
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      attemptsMade = attempt + 1;
      try {
        const response = await zeptoMailRequest(
          'email/template',
          {
            template_key: templateKey,
            from: { address: activeSender.address, name: activeSender.name },
            to: [
              {
                email_address: {
                  address: recipientEmail,
                  name: toName || recipientEmail,
                },
              },
            ],
            merge_info: mergeInfo,
            ...(replyTo && {
              reply_to: [
                {
                  address: replyTo,
                  name: replyTo,
                },
              ],
            }),
          },
          getRequiredToken()
        );

        await updateEmailAttempts(auditIds, {
          status: 'accepted',
          provider_message_id: response?.request_id || 'unknown',
          attempt_count: attemptOffset + attempt + 1,
          from_address: activeSender.address,
        });

        return {
          ok: { success: true, messageId: response?.request_id || 'unknown' },
        };
      } catch (error) {
        failure = parseError(error);

        if (
          attempt < RETRY_CONFIG.maxRetries &&
          isRetryableError(failure.code)
        ) {
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

  const primary = await dispatchTemplate(sender, 0);
  if ('ok' in primary) {
    return primary.ok;
  }
  lastError = primary.failed;
  let totalAttempts = primary.attempts;
  let finalSenderAddress = sender.address;

  // Fail-open: mirror sendEmail — a merchant custom sender may be rejected, so
  // retry once from the platform domain rather than dropping the email.
  if (sender.isCustomDomain) {
    const platformSender = getSenderAddress(emailType, fromName);
    console.warn(
      `ZeptoMail custom template sender rejected (${lastError?.code ?? 'unknown'}); retrying from platform sender`
    );
    // Offset by the primary's actual tries (see sendEmail) so a first-try
    // fallback success records attempt_count as primary.attempts + 1.
    const fallback = await dispatchTemplate(platformSender, primary.attempts);
    if ('ok' in fallback) {
      return fallback.ok;
    }
    lastError = fallback.failed;
    totalAttempts += fallback.attempts;
    finalSenderAddress = platformSender.address;
  }

  console.error('ZeptoMail template email error:', JSON.stringify(lastError));
  await updateEmailAttempts(auditIds, {
    status: 'failed',
    attempt_count: totalAttempts,
    from_address: finalSenderAddress,
    provider_error_code: lastError?.code,
    provider_error_message: lastError?.message || 'Unknown error',
    provider_error_details: lastError?.details,
  });
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    errorCode: lastError?.code,
    errorDetails: lastError?.details,
  };
}

/**
 * Send batch emails via ZeptoMail using a template
 */
export async function sendBatchEmailWithTemplate({
  recipients,
  templateKey,
  emailType = 'noreply',
  fromName,
  auditContext,
}: {
  recipients: Array<{
    to: string;
    toName?: string;
    mergeInfo: Record<string, string>;
  }>;
  templateKey: string;
  emailType?: EmailType;
  fromName?: string;
  auditContext?: EmailAuditContext;
}): Promise<EmailResult> {
  const sender = getSenderAddress(emailType, fromName);
  const normalizedRecipients = recipients.map((recipient) => ({
    ...recipient,
    to: normalizeRuntimeRecipientEmail(recipient.to),
  }));

  if (normalizedRecipients.some((recipient) => !recipient.to)) {
    return {
      success: false,
      error: 'Invalid email address',
    };
  }

  const validRecipients = normalizedRecipients as Array<{
    to: string;
    toName?: string;
    mergeInfo: Record<string, string>;
  }>;

  // Validate all emails
  const invalidEmails = validRecipients.filter((r) => !isValidEmail(r.to));
  if (invalidEmails.length > 0) {
    await insertEmailAttempts(
      invalidEmails.map((recipient) =>
        createAuditAttempt({
          transportType: 'batch_template',
          emailType,
          recipientEmail: recipient.to,
          recipientName: recipient.toName,
          fromAddress: sender.address,
          fromName: sender.name,
          templateKey,
          auditContext,
          status: 'failed',
          providerErrorMessage: `Invalid email address: ${recipient.to}`,
        })
      )
    );

    return {
      success: false,
      error: `Invalid email addresses: ${invalidEmails.map((r) => r.to).join(', ')}`,
    };
  }

  let lastError: { message: string; code?: string; details?: unknown } | null =
    null;
  const auditIds = await insertEmailAttempts(
    validRecipients.map((recipient) =>
      createAuditAttempt({
        transportType: 'batch_template',
        emailType,
        recipientEmail: recipient.to,
        recipientName: recipient.toName,
        fromAddress: sender.address,
        fromName: sender.name,
        templateKey,
        auditContext,
        metadata: { mergeInfoKeys: Object.keys(recipient.mergeInfo) },
      })
    )
  );

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await zeptoMailRequest(
        'email/template/batch',
        {
          template_key: templateKey,
          from: sender,
          to: validRecipients.map((r) => ({
            email_address: {
              address: r.to,
              name: r.toName || r.to,
            },
            merge_info: r.mergeInfo,
          })),
        },
        getRequiredToken()
      );

      await updateEmailAttempts(auditIds, {
        status: 'accepted',
        provider_message_id: response?.request_id || 'unknown',
        attempt_count: attempt + 1,
      });

      return {
        success: true,
        messageId: response?.request_id || 'unknown',
      };
    } catch (error) {
      lastError = parseError(error);

      if (
        attempt < RETRY_CONFIG.maxRetries &&
        isRetryableError(lastError.code)
      ) {
        const delay = RETRY_CONFIG.baseDelayMs * 2 ** attempt;
        console.warn(
          `ZeptoMail retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} after ${delay}ms: ${lastError.message}`
        );
        await sleep(delay);
        continue;
      }

      break;
    }
  }

  console.error('ZeptoMail batch email error:', JSON.stringify(lastError));
  await updateEmailAttempts(auditIds, {
    status: 'failed',
    attempt_count: RETRY_CONFIG.maxRetries + 1,
    provider_error_code: lastError?.code,
    provider_error_message: lastError?.message || 'Unknown error',
    provider_error_details: lastError?.details,
  });
  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    errorCode: lastError?.code,
    errorDetails: lastError?.details,
  };
}
