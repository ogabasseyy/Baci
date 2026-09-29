import type { HealableGateway } from './verify-gateway-charge';

/**
 * Gateway-neutral duplicate-capture evidence. Amounts come from the
 * verification RESPONSE (Paystack kobo, Korapay/Juicyway major), never from
 * re-scaling the normalized major total: stablecoin captures have no minor
 * units, so deriving minor units would overstate them 100x on the ops
 * review. Status is the gateway's own vocabulary verbatim.
 */
export interface DuplicateCaptureResponseEvidence {
  providerAmount: number;
  providerReference: string;
  providerStatus: string;
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extract review evidence from a successful charge verification. Returns
 * null when the response shape cannot identify the charge (unknown id or
 * unusable amount): the caller fails closed so the row retries instead of
 * filing unattributed evidence. Korapay exposes no separate charge id, so
 * the verified reference identifies the charge.
 */
export function extractDuplicateCaptureEvidence(
  gateway: HealableGateway,
  response: Record<string, unknown>
): DuplicateCaptureResponseEvidence | null {
  if (gateway === 'juicyway') {
    const payment = asRecord(response.payment);
    if (!payment) return null;
    const providerAmount = asPositiveNumber(payment.amount);
    const providerStatus = asNonEmptyString(payment.status);
    const providerReference = asNonEmptyString(payment.id);
    if (
      providerAmount === null ||
      providerStatus === null ||
      providerReference === null
    ) {
      return null;
    }
    return { providerAmount, providerReference, providerStatus };
  }
  const providerAmount = asPositiveNumber(response.amount);
  const providerStatus = asNonEmptyString(response.status);
  const providerReference =
    gateway === 'korapay'
      ? asNonEmptyString(response.reference)
      : asNonEmptyString(response.id);
  if (
    providerAmount === null ||
    providerStatus === null ||
    providerReference === null
  ) {
    return null;
  }
  return { providerAmount, providerReference, providerStatus };
}
