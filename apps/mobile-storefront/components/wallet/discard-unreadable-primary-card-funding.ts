import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { primaryWalletCardSchemas } from '@/schemas/primary-wallet-card';

const client = createPrimaryWalletCardFundingClient();

/**
 * Clears an unreadable saved PiggyVest card funding once the customer has
 * agreed to continue: the card client drops a record it can't parse when it
 * reads it. A readable record is left untouched (and still recovered first).
 */
export async function discardUnreadablePrimaryCardFunding(
  merchantId: string | undefined,
  userId: string | undefined
): Promise<void> {
  const scope = primaryWalletCardSchemas.scope.safeParse({
    merchantId,
    userId,
  });
  if (!scope.success) return;
  await client.readPending(scope.data).catch(() => undefined);
}
