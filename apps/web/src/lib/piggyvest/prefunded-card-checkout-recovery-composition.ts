import 'server-only';
import { prefundedCardCheckoutRecoverySchemas as recoverySchemas } from '@/schemas/prefunded-card-checkout-recovery';
import { createPrefundedCardCheckoutDatabase } from './prefunded-card-checkout-database';
import { createPrefundedCardCheckoutProvider } from './prefunded-card-checkout-provider';
import { createPrefundedCardCheckoutRecovery } from './prefunded-card-checkout-recovery';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';

export function createPrefundedCardCheckoutRecoveryComposition({
  configuration,
  fetchImplementation,
  now = Date.now,
}: {
  configuration: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  const parsed = recoverySchemas.composition.safeParse(configuration);
  if (!parsed.success) throw new Error('First-card recovery unavailable');
  const settings = parsed.data;
  const execute = createPrefundedCardPostgresExecutor(
    settings.authorizerDatabase
  );
  const unavailableCustomerExecutor = (): Promise<never> =>
    Promise.reject(new Error('First-card recovery unavailable'));
  const store = createPrefundedCardCheckoutDatabase({
    scope: settings.scope,
    customerExecute: unavailableCustomerExecutor,
    verifierExecute: execute,
    now,
  });

  return createPrefundedCardCheckoutRecovery({
    scope: settings.scope,
    listCandidates: async ({ scope, after, limit }) => {
      try {
        const response = await execute(
          statements.checkoutRecoveryCandidates.text,
          [JSON.stringify(scope), JSON.stringify(after), String(limit)]
        );
        return recoverySchemas.resultRows.parse(response.rows)[0].result;
      } catch {
        throw new Error('First-card recovery unavailable');
      }
    },
    provider: createPrefundedCardCheckoutProvider({
      settings: settings.provider,
      fetchImplementation,
      now,
    }),
    store,
  });
}
