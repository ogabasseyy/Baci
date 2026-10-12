import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prefundedCardCheckoutSchemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutEmailSchema } from '@/schemas/prefunded-card-checkout-email';
import { prefundedCardCheckoutPublicSchemas as schemas } from '@/schemas/prefunded-card-checkout-public-runtime';
import { createPrefundedCardCheckoutComposition } from './prefunded-card-checkout-composition';
import { resolvePrefundedCardCheckoutPublicContext } from './prefunded-card-checkout-public-context';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS } from './prefunded-card-postgres-statements';

const unavailable = (): never => {
  throw new Error('First-card checkout unavailable');
};

export function readPrefundedCardCheckoutPublicRuntime({
  authOrigin,
  environment = process.env,
  fetchImplementation = fetch,
}: {
  authOrigin: string;
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
}) {
  if (environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED !== 'true')
    return null;
  try {
    const serialized = environment.PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG;
    if (typeof serialized !== 'string') return unavailable();
    if (Buffer.byteLength(serialized, 'utf8') > 65_536) return unavailable();
    const configuration = schemas.configuration.parse(JSON.parse(serialized));
    const expiresAt = Date.parse(configuration.expiresAt);
    if (
      authOrigin !== configuration.authOrigin ||
      environment.NEXT_PUBLIC_SUPABASE_URL !== configuration.authOrigin ||
      !Number.isFinite(expiresAt) ||
      Date.now() >= expiresAt
    ) {
      unavailable();
    }

    const mutationsEnabled =
      environment.PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED === 'true';
    return Object.freeze({
      publicOrigin: configuration.publicOrigin,
      mutationsEnabled,
      customer(supabase: SupabaseClient) {
        const capabilityExecute = createPrefundedCardPostgresExecutor(
          configuration.checkout.customerDatabase
        );
        const resolveCustomer = async (
          goalId: string,
          requirePaymentEmail = false
        ) => {
          const resolved = await resolvePrefundedCardCheckoutPublicContext({
            configuration: configuration.context,
            goalId,
            supabase,
          });
          if (resolved.status === 'ready') {
            if (
              requirePaymentEmail &&
              !prefundedCardCheckoutEmailSchema.safeParse(resolved.email)
                .success
            )
              return unavailable();
            return {
              actorId: resolved.actorId,
              customerId: resolved.customerId,
              goalId: resolved.goalId,
            };
          }
          return unavailable();
        };
        const checkoutRuntime = (requirePaymentEmail: boolean) =>
          createPrefundedCardCheckoutComposition({
            configuration: configuration.checkout,
            fetchImplementation,
            resolveCustomer: (goalId) =>
              resolveCustomer(goalId, requirePaymentEmail),
          });
        const runtime = checkoutRuntime(false);
        return Object.freeze({
          async capability({ goalId }: { goalId: string }) {
            const customer = await resolveCustomer(goalId, true);
            if (Date.now() >= expiresAt) unavailable();
            if (!mutationsEnabled) {
              return {
                goalId: customer.goalId,
                enabled: false,
                maximumAmountKobo: 0,
                currency: 'NGN' as const,
              };
            }
            const response = await capabilityExecute(
              PREFUNDED_CARD_POSTGRES_STATEMENTS.checkoutCapability.text,
              [
                JSON.stringify(configuration.checkout.scope),
                customer.customerId,
                customer.actorId,
                customer.goalId,
                String(configuration.maximumAmountKobo),
              ]
            );
            if (response.rows.length !== 1) return unavailable();
            const [row] = response.rows;
            if (!row || typeof row !== 'object' || !('result' in row))
              return unavailable();
            const result = schemas.capability.parse(row.result);
            if (result.goalId !== goalId) unavailable();
            return result;
          },
          async refresh(input: unknown) {
            if (!mutationsEnabled) return unavailable();
            return await runtime.refresh(input);
          },
          async start(input: unknown) {
            if (!mutationsEnabled) return unavailable();
            const request =
              prefundedCardCheckoutSchemas.customerRequest.parse(input);
            if (request.amountKobo > configuration.maximumAmountKobo)
              unavailable();
            return await checkoutRuntime(true).start(request);
          },
        });
      },
    });
  } catch {
    unavailable();
  }
}
