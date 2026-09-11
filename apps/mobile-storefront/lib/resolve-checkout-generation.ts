import { persistCheckoutGeneration } from '@/lib/persist-checkout-generation';
import { readPersistedCheckoutGeneration } from '@/lib/read-persisted-checkout-generation';

export type ResolveCheckoutGenerationOptions = {
  frozen?: boolean;
  persistFrozen?: boolean;
  liveGeneration?: string;
};

export async function resolveCheckoutGeneration(
  cartGeneration: string,
  options?: ResolveCheckoutGenerationOptions
): Promise<string> {
  if (options?.frozen) {
    if (
      options.persistFrozen &&
      (options.liveGeneration === undefined ||
        options.liveGeneration === cartGeneration)
    ) {
      await persistCheckoutGeneration(cartGeneration);
    }
    return cartGeneration;
  }
  const persisted = await readPersistedCheckoutGeneration();
  if (persisted) return persisted;
  await persistCheckoutGeneration(cartGeneration);
  return cartGeneration;
}
