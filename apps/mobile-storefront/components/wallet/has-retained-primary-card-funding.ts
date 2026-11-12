import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';

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
  if (!merchantId || !userId) return false;
  try {
    return (await client.readPending({ merchantId, userId })) !== null;
  } catch {
    // Unreadable storage: assume something may be saved, so the primary
    // path (which re-reads and recovers or reports) handles it.
    return true;
  }
}
