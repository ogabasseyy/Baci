import { getCustomerSavingsApiClient } from '@/lib/customer-savings-api';
import { SavingsGoalSummarySchema } from '@/schemas/customer-savings';

/**
 * Creates a savings goal. `expectedUserId` pins the request to the account
 * that submitted the form: if a different account is signed in by the time
 * the request is sent, it throws before anything leaves the device, so a
 * draft (and any auto-debit authorization) can never become another
 * customer's plan.
 */
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
  expectedUserId?: string;
  goalIdempotencyKey?: string;
  initialContributionAmount?: number;
  initialContributionIdempotencyKey?: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  savedPaymentMethodId?: string | null;
  title?: string;
  variantId?: string | null;
}) {
  const { expectedUserId, ...fields } = input;
  const customerSavingsApiClient = getCustomerSavingsApiClient();
  const data = await customerSavingsApiClient.fetchJson({
    body: {
      ...fields,
      ...customerSavingsApiClient.buildMerchantIdentifiers(fields),
    },
    expectedUserId,
    method: 'POST',
    path: '/api/storefront/customer/savings/goals',
  });
  return SavingsGoalSummarySchema.parse(data);
}
