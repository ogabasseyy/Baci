import { getCustomerSavingsApiClient } from '@/lib/customer-savings-api';
import {
  CustomerPaymentMethodsResponseSchema,
  ListSavingsGoalsResponseSchema,
  SavingsAuthorizationConfirmationResponseSchema,
  SavingsAuthorizationResponseSchema,
  SavingsContributionResponseSchema,
  SavingsDeviceSwapResponseSchema,
  SavingsGoalActionResponseSchema,
  SavingsGoalSummarySchema,
  SavingsPlanFundingResponseSchema,
} from '@/schemas/customer-savings';

export type {
  CustomerPaymentMethod,
  SavingsGoal,
} from '@/schemas/customer-savings';
export { resolveSavingsGoalVariant } from './customer-savings-variant-resolution';

/** Default savings card authorization amount in kobo, NGN minor units. */
export const DEFAULT_SAVINGS_AUTHORIZATION_AMOUNT = 100;
const SAVINGS_AUTHORIZATION_POLL_DELAY_MS = 1200;

export class SavingsAuthorizationStillProcessingError extends Error {
  constructor() {
    super(
      'Savings card authorization is still processing. Check again shortly.'
    );
    this.name = 'SavingsAuthorizationStillProcessingError';
    Object.setPrototypeOf(
      this,
      SavingsAuthorizationStillProcessingError.prototype
    );
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('Savings authorization confirmation cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

function waitForAuthorizationPollDelay(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    throwIfAborted(signal);
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, SAVINGS_AUTHORIZATION_POLL_DELAY_MS);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', handleAbort);
      const error = new Error('Savings authorization confirmation cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function listSavingsGoals({
  merchantId,
  merchantSlug,
  signal,
}: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  signal?: AbortSignal;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    path: '/api/storefront/customer/savings/goals',
    query: { merchantId, merchantSlug },
    signal,
  });
  return ListSavingsGoalsResponseSchema.parse(data);
}

export async function listCustomerPaymentMethods({
  merchantId,
  merchantSlug,
}: {
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    path: '/api/storefront/customer/payment-methods',
    query: { merchantId, merchantSlug },
  });
  return CustomerPaymentMethodsResponseSchema.parse(data).methods;
}

export async function createSavingsGoal(input: {
  contributionAmount: number;
  contributionFrequency: 'daily' | 'weekly' | 'monthly';
  maturityDate: string;
  nonWithdrawableAccepted: true;
  productId: string;
  sourceMode: 'manual' | 'auto_debit';
  startDate: string;
  targetAmount: number;
  termsAccepted: true;
  autoDebitAuthorized?: boolean;
  goalIdempotencyKey?: string;
  initialContributionAmount?: number;
  initialContributionIdempotencyKey?: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  savedPaymentMethodId?: string | null;
  title?: string;
  variantId?: string | null;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      ...input,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/goals',
  });
  return SavingsGoalSummarySchema.parse(data);
}

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

export async function addSavingsContribution(input: {
  amount: number;
  goalId: string;
  idempotencyKey: string;
  description?: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      ...input,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/contributions/manual',
  });
  return SavingsContributionResponseSchema.parse(data);
}

async function mutateGoalStatus(
  path: 'pause' | 'resume' | 'cancel-future-debits',
  input: {
    goalId: string;
    merchantId?: string | null;
    merchantSlug?: string | null;
  }
) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      goalId: input.goalId,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
    },
    method: 'POST',
    path: `/api/storefront/customer/savings/goals/${path}`,
  });
  return SavingsGoalActionResponseSchema.parse(data);
}

export async function pauseSavingsGoal(input: {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  return await mutateGoalStatus('pause', input);
}

export async function resumeSavingsGoal(input: {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  return await mutateGoalStatus('resume', input);
}

export async function cancelSavingsGoalFutureDebits(input: {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  return await mutateGoalStatus('cancel-future-debits', input);
}

export async function swapSavingsGoalDevice(input: {
  goalId: string;
  productId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  variantId?: string | null;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      ...input,
      ...customerSavingsApiClient.buildMerchantIdentifiers(input),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/goals/swap-device',
  });
  return SavingsDeviceSwapResponseSchema.parse(data);
}

export async function initializeSavingsAuthorization({
  amount = DEFAULT_SAVINGS_AUTHORIZATION_AMOUNT,
  merchantId,
  merchantSlug,
}: {
  amount?: number;
  merchantId?: string | null;
  merchantSlug?: string | null;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      amount,
      ...customerSavingsApiClient.buildMerchantIdentifiers({
        merchantId,
        merchantSlug,
      }),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/auto-debit/authorize',
  });
  return SavingsAuthorizationResponseSchema.parse(data);
}

export async function confirmSavingsAuthorization({
  merchantId,
  merchantSlug,
  reference,
  signal,
}: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  reference: string;
  signal?: AbortSignal;
}) {
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      reference,
      ...customerSavingsApiClient.buildMerchantIdentifiers({
        merchantId,
        merchantSlug,
      }),
    },
    method: 'POST',
    path: '/api/storefront/customer/savings/auto-debit/confirm',
    signal,
  });
  return SavingsAuthorizationConfirmationResponseSchema.parse(data);
}

export async function waitForSavingsAuthorizationConfirmation({
  maxAttempts = 10,
  merchantId,
  merchantSlug,
  reference,
  signal,
}: {
  maxAttempts?: number;
  merchantId?: string | null;
  merchantSlug?: string | null;
  reference: string;
  signal?: AbortSignal;
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    const confirmation = await confirmSavingsAuthorization({
      merchantId,
      merchantSlug,
      reference,
      signal,
    });
    throwIfAborted(signal);
    if (confirmation.status === 'successful') {
      return confirmation;
    }

    if (attempt < maxAttempts - 1) {
      await waitForAuthorizationPollDelay(signal);
    }
  }

  throw new SavingsAuthorizationStillProcessingError();
}
