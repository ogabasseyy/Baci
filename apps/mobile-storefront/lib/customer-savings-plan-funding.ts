import { SavingsPlanFundingResponseSchema } from '@/schemas/customer-savings';
import { PrimarySavingsPlanFundingSchemas as schemas } from '@/schemas/primary-savings-plan-funding';
import { getCustomerSavingsApiClient } from './customer-savings-api';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import { isPrimaryWalletNotReady } from './piggyvest-primary-capability';

type Selection = {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  signal?: AbortSignal;
};

async function primaryFunding(input: Selection, interestAccepted?: boolean) {
  const selection = schemas.selection.parse({
    merchantId: input.merchantId,
    goalId: input.goalId,
  });
  const response = schemas.response.parse(
    await getCustomerSavingsApiClient().fetchJson({
      path: '/api/storefront/customer/savings/primary-provisioning',
      method: interestAccepted === undefined ? 'PATCH' : 'POST',
      includeCsrf: true,
      signal: input.signal,
      body:
        interestAccepted === undefined
          ? selection
          : schemas.request.parse({
              ...selection,
              consent: true,
              interestAccepted,
            }),
    })
  );
  if (response.goalId !== selection.goalId)
    throw new Error('Could not confirm this plan account.');
  if (response.status === 'conflict')
    throw new Error(
      'This plan account needs review. Please contact support before trying again.'
    );
  if (response.status === 'not_found')
    throw new Error('This plan account has not been set up yet.');
  return SavingsPlanFundingResponseSchema.parse(response);
}

export const customerSavingsPlanFunding = {
  async provision(
    input: Selection & { bvn: string; enableInterestAccrual?: boolean }
  ) {
    if (isPiggyvestPrimaryMerchant(input.merchantId)) {
      try {
        return await primaryFunding(input, input.enableInterestAccrual === true);
      } catch (error) {
        if (!isPrimaryWalletNotReady(error)) throw error;
      }
    }
    const client = getCustomerSavingsApiClient();
    return SavingsPlanFundingResponseSchema.parse(
      await client.fetchJson({
        body: {
          bvn: input.bvn,
          goalId: input.goalId,
          ...(input.enableInterestAccrual === true
            ? { enableInterestAccrual: true }
            : {}),
        },
        method: 'POST',
        path: '/api/storefront/customer/savings/funding',
        query: client.buildMerchantIdentifiers(input),
        signal: input.signal,
      })
    );
  },
  async recover(input: Selection) {
    if (isPiggyvestPrimaryMerchant(input.merchantId)) {
      try {
        return await primaryFunding(input);
      } catch (error) {
        if (!isPrimaryWalletNotReady(error)) throw error;
      }
    }
    const client = getCustomerSavingsApiClient();
    return SavingsPlanFundingResponseSchema.parse(
      await client.fetchJson({
        method: 'GET',
        path: '/api/storefront/customer/savings/funding',
        query: {
          goalId: input.goalId,
          ...client.buildMerchantIdentifiers(input),
        },
        signal: input.signal,
      })
    );
  },
};
