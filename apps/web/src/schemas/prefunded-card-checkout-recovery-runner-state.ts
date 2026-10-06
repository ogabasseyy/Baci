import { z } from 'zod';
import { prefundedCardCheckoutSchemas } from './prefunded-card-checkout';
import { prefundedCardCheckoutRecoverySchemas as recoverySchemas } from './prefunded-card-checkout-recovery';

const scope = prefundedCardCheckoutSchemas.scope.extend({
  databaseName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
});
const cursor = recoverySchemas.cursor;
const checkpoint = z.strictObject({
  version: z.literal(1),
  scope,
  cursor: cursor.nullable(),
});
const lease = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('acquired'),
    scope,
    token: z.uuid(),
    cursor: cursor.nullable(),
  }),
  z.strictObject({ outcome: z.literal('busy') }),
]);
const result = z.strictObject({
  candidates: z.number().int().min(0).max(20),
  failed: z.number().int().min(0).max(20),
  nextCursor: cursor.nullable(),
  wrapped: z.boolean(),
  pending: z.number().int().min(0).max(20),
  reconciliations: z.number().int().min(0).max(20),
  promoted: z.number().int().min(0).max(20),
});
const cliConfiguration = z
  .strictObject({
    scope,
    recovery: recoverySchemas.composition,
    stateDirectory: z.literal('/var/lib/baci-staging/prefunded-first-card'),
  })
  .superRefine((value, context) => {
    const { databaseName, ...recoveryScope } = value.scope;
    if (
      Object.keys(recoveryScope).some(
        (key) =>
          recoveryScope[key as keyof typeof recoveryScope] !==
          value.recovery.scope[key as keyof typeof value.recovery.scope]
      ) ||
      value.recovery.authorizerDatabase.database !== databaseName ||
      value.recovery.authorizerDatabase.expectedSystemId !==
        value.scope.systemIdentifier
    ) {
      context.addIssue({
        code: 'custom',
        message: 'First-card recovery runner unavailable',
      });
    }
  });

export const prefundedCardCheckoutRecoveryRunnerStateSchemas = {
  scope,
  token: z.uuid(),
  lease,
  cursor,
  checkpoint,
  storedCheckpoint: checkpoint.nullable(),
  result,
  recoveryResult: result,
  cliConfiguration,
};
