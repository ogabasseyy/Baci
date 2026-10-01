import { createLogger } from '@/lib/logger';
import { readPersistedCheckoutGeneration } from '@/lib/read-persisted-checkout-generation';

const log = createLogger('CartStore');

export async function applyPersistedCheckoutGeneration(
  setCheckoutGeneration: (generation: string) => void,
  liveIdentity?: {
    generationWhenReadBegan: string;
    getLiveGeneration: () => string;
  }
): Promise<void> {
  try {
    const persisted = await readPersistedCheckoutGeneration();
    if (!persisted) {
      return;
    }
    if (
      liveIdentity &&
      liveIdentity.getLiveGeneration() !== liveIdentity.generationWhenReadBegan
    ) {
      return;
    }
    setCheckoutGeneration(persisted);
  } catch (error) {
    log.error('Failed to rehydrate checkout generation:', error);
  }
}
