import { oxygenOrderPlanResponseSchema } from '@baci/shared/schemas/oxygen-order-plan';
import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';

const api = createStorefrontCustomerApiClient();

export async function readOxygenOrderPlan(
  orderId: string,
  userId: string,
  signal: AbortSignal
) {
  const response = await api.fetchJson({
    path: `/api/payments/oxygen/order-plan?orderId=${encodeURIComponent(orderId)}`,
    expectedUserId: userId,
    signal,
    timeoutMs: 10000,
  });
  return oxygenOrderPlanResponseSchema.parse(response).plan;
}
