import { z } from 'zod';

const connection = {
  port: z.literal(5432),
  database: z.literal('postgres'),
  password: z.string().min(16).max(1024),
  integrationId: z.uuid(),
  businessId: z.string().min(1).max(128),
};

export const replayFinancialSchemas = {
  scope: z.strictObject({
    integrationId: z.uuid(),
    businessId: z.string().min(1).max(128),
    expectedSystemId: z.string().regex(/^[0-9]{1,20}$/),
  }),
  database: z.discriminatedUnion('role', [
    z.strictObject({
      ...connection,
      host: z.literal('baci-isolated-savings-db-1'),
      role: z.literal('piggyvest_staging_ledger_worker'),
    }),
    z.strictObject({
      ...connection,
      host: z.literal('piggyvest-db.staging.baci.internal'),
      role: z.literal('prefunded_treasury_operator'),
      ssl: z.strictObject({ ca: z.string().min(1).max(65536) }),
    }),
  ]),
  outcome: z
    .array(
      z.strictObject({
        result: z.enum([
          'applied',
          'duplicate',
          'deferred',
          'conflict',
          'invalid',
        ]),
      })
    )
    .length(1),
};
