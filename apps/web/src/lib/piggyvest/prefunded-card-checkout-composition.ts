import 'server-only';
import { prefundedCardCheckoutCompositionSchema } from '@/schemas/prefunded-card-checkout-composition';
import { createPrefundedCardCheckoutDatabase } from './prefunded-card-checkout-database';
import { createPrefundedCardCheckoutProvider } from './prefunded-card-checkout-provider';
import { createPrefundedCardCheckoutRuntime } from './prefunded-card-checkout-runtime';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';

export function createPrefundedCardCheckoutComposition({
  configuration,
  resolveCustomer,
  fetchImplementation,
  now = Date.now,
}: {
  configuration: unknown;
  resolveCustomer: (goalId: string) => Promise<unknown>;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const parsed =
    prefundedCardCheckoutCompositionSchema.safeParse(configuration);
  if (!parsed.success) throw new Error('First-card checkout unavailable');
  const settings = parsed.data;
  const store = createPrefundedCardCheckoutDatabase({
    scope: settings.scope,
    customerExecute: createPrefundedCardPostgresExecutor(
      settings.customerDatabase
    ),
    verifierExecute: createPrefundedCardPostgresExecutor(
      settings.verifierDatabase
    ),
    now,
  });
  return createPrefundedCardCheckoutRuntime({
    scope: settings.scope,
    store,
    provider: createPrefundedCardCheckoutProvider({
      settings: settings.provider,
      fetchImplementation,
      now,
    }),
    resolveCustomer,
    now,
  });
}
