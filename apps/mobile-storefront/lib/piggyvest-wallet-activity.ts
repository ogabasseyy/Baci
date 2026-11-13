import {
  type PiggyvestWalletActivityPage,
  piggyvestWalletActivityPageSchema,
} from '@/schemas/piggyvest-wallet-activity';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const PATH = '/api/storefront/customer/wallet/piggyvest-activity';

/**
 * One page of the signed-in customer's PiggyVest wallet activity. A fresh
 * client per call binds the expected user (no token survives an account
 * switch). Anything the schema rejects is an error, never a partial list.
 */
export async function fetchPiggyvestWalletActivity(input: {
  merchantId: string;
  userId?: string;
  cursor?: string | null;
}): Promise<PiggyvestWalletActivityPage> {
  const query = new URLSearchParams({ merchantId: input.merchantId });
  if (input.cursor) query.set('cursor', input.cursor);
  const data = await createStorefrontCustomerApiClient().fetchJson({
    path: `${PATH}?${query.toString()}`,
    expectedUserId: input.userId,
  });
  const page = piggyvestWalletActivityPageSchema.safeParse(data);
  if (!page.success) throw new Error('We couldn’t load your wallet activity.');
  return page.data;
}
