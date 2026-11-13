import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { primaryWalletCardSchemas } from '@/schemas/primary-wallet-card';

const client = createPrimaryWalletCardFundingClient();

/** The card client's storage key for a funding scope (kept in step by test). */
function storageKey(scope: { merchantId: string; userId: string }) {
  return `@baci_primary_card:${scope.merchantId}:${scope.userId}`;
}

/**
 * True when this device saved a PiggyVest card funding for the customer
 * that may already have charged the card. Reads local storage only. A
 * purchase top-up must recover that funding first, never start a second
 * (legacy) charge next to it.
 *
 * 'unreadable' (Codex): a saved record exists but can't be parsed. The card
 * client would silently drop it and report nothing, yet the funding it
 * stood for may still have charged, so the caller must block instead.
 */
export async function hasRetainedPrimaryCardFunding(
  merchantId: string | undefined,
  userId: string | undefined
): Promise<boolean | 'unreadable'> {
  // A scope the card client rejects can never have saved a funding.
  const scope = primaryWalletCardSchemas.scope.safeParse({
    merchantId,
    userId,
  });
  if (!scope.success) return false;
  try {
    // Peek at the raw record first: reading through the client deletes a
    // corrupt one.
    const raw = await AsyncStorage.getItem(storageKey(scope.data));
    if (raw === null) return false;
    try {
      primaryWalletCardSchemas.pending.parse(JSON.parse(raw));
    } catch {
      return 'unreadable';
    }
    return (await client.readPending(scope.data)) !== null;
  } catch {
    // Unreadable storage: assume something may be saved, so the primary
    // path (which re-reads and recovers or reports) handles it.
    return true;
  }
}
