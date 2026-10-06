import { getCustomerSavingsApiClient } from '@/lib/customer-savings-api';
import { SavingsPlanFundingResponseSchema } from '@/schemas/customer-savings';

export async function fetchSavingsPlanFunding(input: {
  bvn: string;
  goalId: string;
  enableInterestAccrual?: boolean;
  merchantId?: string | null;
  merchantSlug?: string | null;
  signal?: AbortSignal;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      bvn: input.bvn,
      goalId: input.goalId,
      ...(input.enableInterestAccrual === true
        ? { enableInterestAccrual: true }
        : {}),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/funding',
    query: customerSavingsApiClient.buildMerchantIdentifiers(input),
    signal: input.signal,
  });
  return SavingsPlanFundingResponseSchema.parse(data);
}

export async function fetchExistingSavingsPlanFunding(input: {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  signal?: AbortSignal;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    method: 'GET',
    path: '/api/storefront/customer/savings/funding',
    query: {
      goalId: input.goalId,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
    },
    signal: input.signal,
  });
  return SavingsPlanFundingResponseSchema.parse(data);
}
