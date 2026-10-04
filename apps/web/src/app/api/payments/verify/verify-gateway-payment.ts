import { verifyPayment as verifyKorapayPayment } from '@/lib/korapay';
import type { GatewayVerificationResult } from '@/lib/payments/types';
import { verifyTransaction as verifyPaystackPayment } from '@/lib/paystack';

export function getVerifiedAmount(
  gateway: string,
  gatewayResponse: Record<string, unknown>
): { amount: number; currency?: string } | null {
  const rawAmount = gatewayResponse.amount;
  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    rawAmount <= 0
  ) {
    return null;
  }

  const currency =
    typeof gatewayResponse.currency === 'string'
      ? gatewayResponse.currency
      : undefined;
  // Paystack returns amounts in kobo (smallest unit), divide by 100
  const amount = gateway === 'paystack' ? rawAmount / 100 : rawAmount;

  return { amount, currency };
}

export async function verifyGatewayPayment(
  gateway: string,
  reference: string
): Promise<GatewayVerificationResult> {
  if (gateway === 'paystack') {
    const result = await verifyPaystackPayment(reference);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      status: result.data.status,
      gatewayResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  if (gateway === 'korapay') {
    const result = await verifyKorapayPayment(reference);
    if (!result.success) {
      return result;
    }

    return {
      success: true,
      status: result.data.status,
      gatewayResponse: result.data as unknown as Record<string, unknown>,
    };
  }

  return {
    success: false,
    error: `Unsupported gateway: ${gateway}`,
    code: 'UNSUPPORTED_GATEWAY',
  };
}
