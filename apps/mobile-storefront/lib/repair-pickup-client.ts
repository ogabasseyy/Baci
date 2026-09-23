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

function isLocalDevelopmentHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function requireSecureOrigin(): void {
  const protocol = new URL(origin).protocol;
  if (protocol === 'https:') return;
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    isLocalDevelopmentHost(new URL(origin).hostname)
  )
    return;
  throw new Error(
    'Pickup payment is unavailable: the repair service URL must use HTTPS.'
  );
}

async function post(path: string, body: unknown): Promise<unknown> {
  requireSecureOrigin();
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
    const result: unknown = await response.json().catch(() => {
      throw new Error('Could not contact the repair service.');
    });
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
    const attempt = await repairPickupPaymentAttempt.get(
      data,
      expectedPickupFee,
      resumeToken
    );
    const result = repairPickupSchemas.payment.parse(
      await post('repairs/pickup', {
        action: 'pay',
        ...attempt,
        data,
      })
    );
    // Only a parsed, definitive failure permits a new start. Lost responses
    // retain the same identity, so the server replays rather than reinitializes.
    if (!result.success && result.code !== 'payment_initialization_unknown')
      await repairPickupPaymentAttempt.clear(data).catch(() => undefined);
    return result;
  },
  async status(ticketNumber: number, email: string) {
    return repairPickupSchemas.status.parse(
      await post('repair/status', { ticketNumber, email })
    );
  },
};
