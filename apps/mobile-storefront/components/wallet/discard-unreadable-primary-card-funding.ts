import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { primaryWalletCardSchemas } from '@/schemas/primary-wallet-card';

const client = createPrimaryWalletCardFundingClient();

/**
 * Clears an unreadable saved PiggyVest card funding once the customer has
 * agreed to continue: the card client drops a record it can't parse when it
 * reads it. A readable record is left untouched (and still recovered first).
 * Resolves false when storage couldn't remove the record (Codex), so the
 * caller reports a storage error instead of reopening the same prompt.
 */
export async function discardUnreadablePrimaryCardFunding(
  merchantId: string | undefined,
  userId: string | undefined
): Promise<boolean> {
  const scope = primaryWalletCardSchemas.scope.safeParse({
    merchantId,
    userId,
  });
  if (!scope.success) return true;
  try {
    await client.readPending(scope.data);
    return true;
  } catch {
    return false;
  }
}
