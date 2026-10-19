import { z } from 'zod';
import { prefundedCardCheckoutSchemas } from './prefunded-card-checkout';
import { prefundedCardPostgresExecutorSchema } from './prefunded-card-postgres-executor';

export const prefundedCardCheckoutCompositionSchema = z
  .strictObject({
    scope: prefundedCardCheckoutSchemas.scope,
    customerDatabase: prefundedCardPostgresExecutorSchema,
    verifierDatabase: prefundedCardPostgresExecutorSchema,
    provider: prefundedCardCheckoutSchemas.providerSettings,
  })
  .superRefine((value, context) => {
    const customer = value.customerDatabase;
    const verifier = value.verifierDatabase;
    if (
      customer.profile !== 'checkout_customer' ||
      verifier.profile !== 'checkout_authorizer' ||
      customer.transport !== 'tls' ||
      verifier.transport !== 'tls' ||
      customer.expectedSystemId !== value.scope.systemIdentifier ||
      verifier.expectedSystemId !== value.scope.systemIdentifier ||
      customer.host !== verifier.host ||
      customer.port !== verifier.port ||
      customer.database !== verifier.database ||
      customer.expectedProjectId !== verifier.expectedProjectId ||
      Object.keys(value.scope).some(
        (key) =>
          value.scope[key as keyof typeof value.scope] !==
          value.provider[key as keyof typeof value.scope]
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'First-card configuration mismatch',
      });
  });
