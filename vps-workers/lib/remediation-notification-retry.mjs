import { redactCodexError } from './remediation-codex-output.mjs';
import { sendRemediationReportEmail } from './remediation-report.mjs';
import { readPositiveInt } from './remediation-worker-config.mjs';

const DEFAULT_RETRY_BATCH_SIZE = 5;
const DEFAULT_RETRY_DELAY_MS = 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 10 * 1_000;
const MAX_RETRY_BATCH_SIZE = 20;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;
const MAX_RETRY_ATTEMPTS = 5;
const MAX_TIMEOUT_MS = 30 * 1_000;

function configuredPositiveInt(env, name, fallback, maximum) {
  return Math.min(readPositiveInt(env[name], fallback), maximum);
}

function retryDelayMs(attempts) {
  return Math.min(
    DEFAULT_RETRY_DELAY_MS * 2 ** Math.min(attempts || 0, 6),
    MAX_RETRY_DELAY_MS
  );
}

export async function retryRemediationNotifications({
  env,
  fetchFn,
  logger,
  now = () => Date.now(),
  state,
  workerName,
}) {
  const actions = [];
  let email = { reason: 'no candidates', skipped: true };
  const nowMs = now();
  const retryBatchSize = configuredPositiveInt(
    env,
    'BACI_REMEDIATION_NOTIFICATION_RETRY_BATCH_SIZE',
    DEFAULT_RETRY_BATCH_SIZE,
    MAX_RETRY_BATCH_SIZE
  );
  const timeoutMs = configuredPositiveInt(
    env,
    'BACI_REMEDIATION_NOTIFICATION_TIMEOUT_MS',
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  for (const notification of state.notifications({
    limit: retryBatchSize,
    nowMs,
  })) {
    try {
      email = await sendRemediationReportEmail({
        env,
        fetchFn,
        report: notification.report,
        timeoutMs,
      });
      if (email.skipped)
        actions.push({ detail: notification.id, type: 'email_skipped' });
      else {
        if (!state.acknowledgeNotification(notification.id)) {
          throw new Error('remediation notification acknowledgement failed');
        }
        actions.push({ detail: notification.id, type: 'email_retried' });
      }
    } catch (error) {
      const safeError = redactCodexError(error);
      const detail = safeError.message;
      if (notification.attempts >= MAX_RETRY_ATTEMPTS) {
        if (state.acknowledgeNotification(notification.id)) {
          logger.error(`[${workerName}] notification retry exhausted`);
          actions.push({
            detail: notification.id,
            type: 'email_retry_exhausted',
          });
        } else {
          logger.error(
            `[${workerName}] exhausted notification acknowledgement failed`
          );
          actions.push({
            detail: 'remediation notification acknowledgement failed',
            type: 'email_retry_exhausted_acknowledgement_failed',
          });
        }
        email = { reason: 'notification retry exhausted', skipped: true };
      } else {
        state.scheduleNotificationRetry(
          notification.id,
          new Date(nowMs + retryDelayMs(notification.attempts)).toISOString()
        );
        logger.error(`[${workerName}] report email retry failed:`, safeError);
        actions.push({ detail, type: 'email_retry_failed' });
        email = { error: detail, skipped: true };
      }
    }
  }
  return { actions, email };
}
