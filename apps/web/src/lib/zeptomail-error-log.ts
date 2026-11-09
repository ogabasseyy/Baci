import type { SendFailure } from '@/lib/zeptomail-send-error';

/**
 * Logs a final ZeptoMail send failure. Redacted mode logs only the provider
 * error code, for call graphs that must keep provider bodies out of logs.
 */
export function logZeptoMailSendFailure(
  failure: SendFailure,
  redact: boolean
): void {
  console.error(
    'ZeptoMail email error:',
    redact ? (failure.code ?? 'unknown') : JSON.stringify(failure)
  );
}
