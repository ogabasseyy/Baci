import { createLogger } from '@/lib/logger';
import { readPersistedCheckoutGeneration } from '@/lib/read-persisted-checkout-generation';

const log = createLogger('CartStore');

export async function applyPersistedCheckoutGeneration(
  setCheckoutGeneration: (generation: string) => void
): Promise<void> {
  try {
    const persisted = await readPersistedCheckoutGeneration();
    if (persisted) {
      setCheckoutGeneration(persisted);
    }
  } catch (error) {
    log.error('Failed to rehydrate checkout generation:', error);
  }
}
