import { OTP_CODE_TTL_SECONDS } from '@/components/ui/otp-verification/use-otp-expiry';

const prefix = 'oxygen:phone-otp-sent:';
const memory = new Map<string, number>();
/** Timing metadata only. Never store an OTP, identity fields or provider tokens. */
export function rememberPhoneOtpSend(workflowId: string, requestedAt: number) {
  if (!Number.isFinite(requestedAt) || requestedAt <= 0) return;
  for (const [key, time] of memory) {
    if (Date.now() - time > OTP_CODE_TTL_SECONDS * 1000) memory.delete(key);
  }
  memory.set(workflowId, requestedAt);
  try {
    sessionStorage.setItem(`${prefix}${workflowId}`, String(requestedAt));
  } catch {
    /* A blocked browser store must not break verification. */
  }
}
export function readPhoneOtpSend(workflowId?: string): number | undefined {
  if (!workflowId) return;
  let time = memory.get(workflowId);
  try {
    const saved = sessionStorage.getItem(`${prefix}${workflowId}`);
    if (saved !== null) time = Number(saved);
  } catch {
    /* Use this page's in-memory send time. */
  }
  return time !== undefined &&
    Number.isFinite(time) &&
    time > 0 &&
    time <= Date.now()
    ? time
    : undefined;
}
