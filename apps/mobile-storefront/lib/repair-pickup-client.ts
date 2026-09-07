import Constants from 'expo-constants';
import { resolveApiBaseUrl } from '@/lib/api-url';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupPaymentAttempt } from '@/lib/repair-pickup-payment-attempt';
import { repairPickupSchemas } from '@/schemas/repair-pickup';

const origin = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);
const merchant = encodeURIComponent(
  Constants.expoConfig?.extra?.merchantSlug || 'ogabassey'
);

async function post(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(
      `${origin}/api/storefront/${merchant}/${path}`,
      {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    const result: unknown = await response.json();
    if (!response.ok) {
      const error = repairPickupSchemas.error.safeParse(result);
      throw new Error(
        error.success
          ? error.data.error
          : 'Could not contact the repair service.'
      );
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        'Request timed out. Check pickup status before retrying payment.'
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const repairPickupClient = {
  async quote(data: RepairBookingRequest) {
    return repairPickupSchemas.quote.parse(
      await post('repairs/pickup', { action: 'quote', data })
    );
  },
  async pay(
    data: RepairBookingRequest,
    expectedPickupFee: number,
    resumeToken?: string
  ) {
    const requestId = await repairPickupPaymentAttempt.get(
      data,
      expectedPickupFee,
      resumeToken
    );
    const result = repairPickupSchemas.payment.parse(
      await post('repairs/pickup', {
        action: 'pay',
        requestId,
        data,
        expectedPickupFee,
        resumeToken,
      })
    );
    // Only a parsed, definitive failure permits a new start. Lost responses
    // retain the same identity, so the server replays rather than reinitializes.
    if (!result.success) await repairPickupPaymentAttempt.clear(data);
    return result;
  },
  async status(ticketNumber: number, email: string) {
    return repairPickupSchemas.status.parse(
      await post('repair/status', { ticketNumber, email })
    );
  },
};
