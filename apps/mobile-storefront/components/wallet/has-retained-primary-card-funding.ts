import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { primaryWalletCardSchemas } from '@/schemas/primary-wallet-card';

const client = createPrimaryWalletCardFundingClient();

/**
 * True when this device saved a PiggyVest card funding for the customer
 * that may already have charged the card. Reads local storage only. A
 * purchase top-up must recover that funding first, never start a second
 * (legacy) charge next to it.
 */
export async function hasRetainedPrimaryCardFunding(
  merchantId: string | undefined,
  userId: string | undefined
): Promise<boolean> {
  // A scope the card client rejects can never have saved a funding.
  const scope = primaryWalletCardSchemas.scope.safeParse({
    merchantId,
    userId,
  });
  if (!scope.success) return false;
  try {
    return (await client.readPending(scope.data)) !== null;
  } catch {
    // Unreadable storage: assume something may be saved, so the primary
    // path (which re-reads and recovers or reports) handles it.
    return true;
  }
}
