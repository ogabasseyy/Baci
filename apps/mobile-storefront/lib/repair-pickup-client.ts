import Constants from 'expo-constants';
import { resolveApiBaseUrl } from '@/lib/api-url';
import type { RepairBookingRequest } from '@/lib/repair-catalog-schemas';
import { repairPickupSchemas } from '@/schemas/repair-pickup';

const origin = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);
const merchant = encodeURIComponent(
  Constants.expoConfig?.extra?.merchantSlug || 'ogabassey'
);

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${origin}/api/storefront/${merchant}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = repairPickupSchemas.error.safeParse(result);
    throw new Error(
      error.success ? error.data.error : 'Could not contact the repair service.'
    );
  }
  return result;
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
    return repairPickupSchemas.payment.parse(
      await post('repairs/pickup', {
        action: 'pay',
        data,
        expectedPickupFee,
        resumeToken,
      })
    );
  },
  async status(ticketNumber: number, email: string) {
    return repairPickupSchemas.status.parse(
      await post('repair/status', { ticketNumber, email })
    );
  },
};
