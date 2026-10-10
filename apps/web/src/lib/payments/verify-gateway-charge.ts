import { getPaymentSession as getJuicywayPaymentSession } from '@/lib/juicyway';
import { verifyPayment as verifyKorapayPayment } from '@/lib/korapay';
import { shouldRequireJuicywaySettlementMetadata } from '@/lib/payments/juicyway-settlement-metadata-compatibility';
import { JUICYWAY_UNDERPAYMENT_TOLERANCE } from '@/lib/payments/juicyway-settlement-policy';
import { verifyTransaction as verifyPaystackPayment } from '@/lib/paystack';

export const HEALABLE_GATEWAYS = ['paystack', 'korapay', 'juicyway'] as const;
export type HealableGateway = (typeof HEALABLE_GATEWAYS)[number];

export interface GatewayChargeVerificationContext {
  juicywayExpectedAmount?: number;
  juicywayExpectedCurrency?: string;
  juicywayHasExpectedSettlementMetadata?: boolean;
  juicywaySessionId?: string;
  juicywayTransactionCreatedAt?: string;
}

export function buildJuicywayVerificationContext(
  metadata: Record<string, unknown> | null | undefined,
  createdAt?: unknown
): GatewayChargeVerificationContext {
  const safeMetadata = metadata ?? {};
  const rawExpectedAmount = safeMetadata.juicyway_expected_amount;
  return {
    juicywayExpectedAmount:
      rawExpectedAmount == null ? undefined : Number(rawExpectedAmount),
    juicywayExpectedCurrency:
      typeof safeMetadata.juicyway_expected_currency === 'string'
        ? safeMetadata.juicyway_expected_currency
        : undefined,
    juicywayHasExpectedSettlementMetadata:
      safeMetadata.juicyway_expected_amount != null ||
      safeMetadata.juicyway_expected_currency != null,
    juicywaySessionId:
      typeof safeMetadata.session_id === 'string'
        ? safeMetadata.session_id
        : undefined,
    juicywayTransactionCreatedAt:
      typeof createdAt === 'string' ? createdAt : undefined,
  };
}

export function isHealableGateway(gateway: string): gateway is HealableGateway {
  return (HEALABLE_GATEWAYS as readonly string[]).includes(gateway);
}

// Gateway client failures that can never succeed on a retry: a malformed or
// unknown reference. Everything else (network, 5xx, config) is transient.
const DEFINITIVE_FAILURE_CODES = new Set([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'TRANSACTION_NOT_FOUND',
  'HTTP_400',
  'HTTP_404',
]);

const TERMINAL_VERIFICATION_REASONS = new Set([
  'amount_mismatch',
  'currency_mismatch',
  'gateway_reference_invalid',
  'gateway_status_not_success',
  'juicyway_verification_invalid_payload',
  'juicyway_verification_context_missing',
  'korapay_verification_invalid_payload',
  'paystack_verification_invalid_payload',
]);

export function isTerminalGatewayVerificationReason(reason: string): boolean {
  return TERMINAL_VERIFICATION_REASONS.has(reason);
}

function classifyFailure(code: string | undefined, gateway: string) {
  return code && DEFINITIVE_FAILURE_CODES.has(code)
    ? { ok: false as const, reason: 'gateway_reference_invalid' }
    : { ok: false as const, reason: `${gateway}_verification_unavailable` };
}

function hasValidChargeEvidence(
  amount: unknown,
  currency: unknown
): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    typeof currency === 'string' &&
    currency.trim().length > 0
  );
}

export type GatewayChargeVerification =
  | {
      ok: true;
      amount: number;
      currency?: string;
      response: Record<string, unknown>;
    }
  | { ok: false; reason: string; gatewayStatus?: string };

// Re-verifies a captured charge with its gateway before the reconcile sweep
// heals anything. Distinguishes transient verification-unavailable failures
// (retry next run) from a definitive non-success verdict (permanent
// discrepancy that must go to ops).
export async function verifyGatewayCharge(
  gateway: HealableGateway,
  reference: string,
  context?: GatewayChargeVerificationContext,
  signal?: AbortSignal
): Promise<GatewayChargeVerification> {
  if (gateway === 'paystack') {
    const result = await verifyPaystackPayment(reference, signal);
    if (!result.success) {
      return classifyFailure(result.code, 'paystack');
    }
    if (result.data.status !== 'success') {
      // Definitive gateway verdict on a transaction we recorded as
      // completed — a real discrepancy that must go to ops.
      return {
        gatewayStatus: result.data.status,
        ok: false,
        reason: 'gateway_status_not_success',
      };
    }
    if (!hasValidChargeEvidence(result.data.amount, result.data.currency)) {
      return { ok: false, reason: 'paystack_verification_invalid_payload' };
    }
    return {
      amount: result.data.amount / 100,
      currency: result.data.currency,
      ok: true,
      response: result.data as unknown as Record<string, unknown>,
    };
  }
  if (gateway === 'korapay') {
    const result = await verifyKorapayPayment(reference, signal);
    if (!result.success) {
      return classifyFailure(result.code, 'korapay');
    }
    if (result.data.status !== 'success') {
      return {
        gatewayStatus: result.data.status,
        ok: false,
        reason: 'gateway_status_not_success',
      };
    }
    if (!hasValidChargeEvidence(result.data.amount, result.data.currency)) {
      return { ok: false, reason: 'korapay_verification_invalid_payload' };
    }
    return {
      amount: result.data.amount,
      currency: result.data.currency,
      ok: true,
      response: result.data as unknown as Record<string, unknown>,
    };
  }
  if (gateway === 'juicyway') {
    const sessionId = context?.juicywaySessionId?.trim();
    const expectedAmount = context?.juicywayExpectedAmount;
    const expectedCurrency = context?.juicywayExpectedCurrency?.trim();
    const requireExpectedSettlementMetadata =
      context?.juicywayHasExpectedSettlementMetadata === true ||
      expectedAmount !== undefined ||
      expectedCurrency !== undefined ||
      shouldRequireJuicywaySettlementMetadata(
        context?.juicywayTransactionCreatedAt
      );
    if (
      !sessionId ||
      (requireExpectedSettlementMetadata &&
        (typeof expectedAmount !== 'number' ||
          !Number.isFinite(expectedAmount) ||
          expectedAmount <= 0 ||
          !expectedCurrency))
    ) {
      return {
        ok: false,
        reason: 'juicyway_verification_context_missing',
      };
    }

    const result = await getJuicywayPaymentSession(sessionId, signal);
    if (!result.success) {
      return classifyFailure(result.code, 'juicyway');
    }

    const response = result.data;
    const payment = response.payment;
    const status =
      typeof payment?.status === 'string'
        ? payment.status.trim().toLowerCase()
        : typeof response.status === 'string'
          ? response.status.trim().toLowerCase()
          : '';
    if (status === 'pending' || status === 'processing') {
      return {
        gatewayStatus: status,
        ok: false,
        reason: 'juicyway_payment_pending',
      };
    }
    if (status === 'failed' || status === 'cancelled') {
      return {
        gatewayStatus: status,
        ok: false,
        reason: 'gateway_status_not_success',
      };
    }
    if (status !== 'succeeded') {
      return {
        ok: false,
        reason: 'juicyway_verification_invalid_payload',
      };
    }

    const settledAmount = payment?.amount;
    const settledCurrency = payment?.currency;
    if (
      !hasValidChargeEvidence(settledAmount, settledCurrency) ||
      typeof settledCurrency !== 'string'
    ) {
      return {
        ok: false,
        reason: 'juicyway_verification_invalid_payload',
      };
    }
    if (requireExpectedSettlementMetadata) {
      if (settledCurrency.toUpperCase() !== expectedCurrency?.toUpperCase()) {
        return { ok: false, reason: 'currency_mismatch' };
      }

      // Match the signed webhook's policy: allow overpayment/dust, but never
      // finalize when the settled stablecoin amount is more than 1% short.
      if (
        settledAmount <
        (expectedAmount ?? 0) * (1 - JUICYWAY_UNDERPAYMENT_TOLERANCE)
      ) {
        return { ok: false, reason: 'amount_mismatch' };
      }
    }

    return {
      amount: settledAmount,
      currency: settledCurrency,
      ok: true,
      response: response as unknown as Record<string, unknown>,
    };
  }
  return { ok: false, reason: 'unhealable_gateway' };
}
