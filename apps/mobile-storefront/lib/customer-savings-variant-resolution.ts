import { SavingsVariantResolutionResponseSchema } from '@/schemas/customer-savings';
import { getCustomerSavingsApiClient } from './customer-savings-api';

export async function resolveSavingsGoalVariant(input: {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  variantId: string;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      goalId: input.goalId,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
      variantId: input.variantId,
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/goals/resolve-variant',
  });
  const response = SavingsVariantResolutionResponseSchema.parse(data);
  if (response.goalId !== input.goalId) {
    throw new Error('Savings goal response did not match the requested goal.');
  }
  return response;
}
