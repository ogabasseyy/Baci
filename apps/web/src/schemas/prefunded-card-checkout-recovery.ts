import { z } from 'zod';
import { prefundedCardCheckoutSchemas } from './prefunded-card-checkout';
import { prefundedCardPostgresExecutorSchema } from './prefunded-card-postgres-executor';

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)));

const cursor = z.strictObject({
  createdAt: timestamp,
  intentId: z.uuid(),
});

const candidate = z
  .strictObject({
    cursor,
    intent: prefundedCardCheckoutSchemas.intent,
  })
  .refine((value) => value.cursor.intentId === value.intent.intentId, {
    message: 'First-card recovery cursor mismatch',
  });

const page = z
  .strictObject({
    candidates: z.array(candidate).max(20),
    nextCursor: cursor.nullable(),
  })
  .superRefine((value, context) => {
    const finalCandidate = value.candidates.at(-1);
    if (
      finalCandidate &&
      JSON.stringify(value.nextCursor) !== JSON.stringify(finalCandidate.cursor)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'First-card recovery cursor does not advance',
      });
    }
  });

const request = z.strictObject({
  after: cursor.nullable().optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export const prefundedCardCheckoutRecoverySchemas = {
  cursor,
  candidate,
  page,
  request,
  resultRows: z.array(z.strictObject({ result: page })).length(1),
  composition: z
    .strictObject({
      scope: prefundedCardCheckoutSchemas.scope,
      authorizerDatabase: prefundedCardPostgresExecutorSchema,
      provider: prefundedCardCheckoutSchemas.providerSettings,
    })
    .superRefine((value, context) => {
      const database = value.authorizerDatabase;
      if (
        database.profile !== 'checkout_authorizer' ||
        database.transport !== 'tls' ||
        database.expectedSystemId !== value.scope.systemIdentifier ||
        Object.keys(value.scope).some(
          (key) =>
            value.scope[key as keyof typeof value.scope] !==
            value.provider[key as keyof typeof value.scope]
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'First-card recovery configuration mismatch',
        });
      }
    }),
};
