import {
  MAX_OTP_EMAIL_ENTRIES,
  OTP_CODE_EXPIRY_MS,
  OTP_RESEND_COOLDOWN_MS,
} from '../constants';

export type OtpSendResult = { success: boolean; error?: string };
export type OtpSendOutcome = {
  result: OtpSendResult;
  cooldownUntil: number | null;
};

export const resendCooldownsByEmail = new Map<string, number>();
export const pendingOtpEmails = new Map<string, number>();
const inFlightOtpSends = new Map<string, Promise<OtpSendOutcome>>();

export function getResendCooldown(email: string): number | null {
  const until = resendCooldownsByEmail.get(email);
  if (!until) return null;
  if (until > Date.now()) return until;
  return null;
}

function pruneExpired(entries: Map<string, number>, now: number) {
  for (const [email, expiresAt] of entries) {
    if (expiresAt <= now) entries.delete(email);
  }
}

function setBoundedExpiry(
  entries: Map<string, number>,
  email: string,
  expiresAt: number,
  now: number
) {
  pruneExpired(entries, now);
  entries.delete(email);
  if (entries.size >= MAX_OTP_EMAIL_ENTRIES) {
    const oldestEmail = entries.keys().next().value;
    if (oldestEmail) entries.delete(oldestEmail);
  }
  entries.set(email, expiresAt);
}

function startResendCooldown(email: string): number {
  const now = Date.now();
  const until = now + OTP_RESEND_COOLDOWN_MS;
  setBoundedExpiry(resendCooldownsByEmail, email, until, now);
  setBoundedExpiry(pendingOtpEmails, email, now + OTP_CODE_EXPIRY_MS, now);
  return until;
}

export function hasPendingOtp(email: string): boolean {
  const expiresAt = pendingOtpEmails.get(email);
  return expiresAt !== undefined && expiresAt > Date.now();
}

export function sendOtpOnce(
  email: string,
  sendCode: (address: string) => Promise<OtpSendResult>
): Promise<OtpSendOutcome> {
  const existing = inFlightOtpSends.get(email);
  if (existing) return existing;
  if (inFlightOtpSends.size >= MAX_OTP_EMAIL_ENTRIES) {
    return Promise.resolve({
      result: {
        success: false,
        error: 'Please wait before requesting another code.',
      },
      cooldownUntil: null,
    });
  }

  let request: Promise<OtpSendOutcome>;
  request = sendCode(email)
    .then((result) => ({
      result,
      cooldownUntil: result.success ? startResendCooldown(email) : null,
    }))
    .finally(() => {
      if (inFlightOtpSends.get(email) === request) {
        inFlightOtpSends.delete(email);
      }
    });
  inFlightOtpSends.set(email, request);
  return request;
}

export function getInFlightOtpSend(email: string) {
  return inFlightOtpSends.get(email);
}
