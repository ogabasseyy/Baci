import { z } from 'zod';

const submissionParameters = [
  z.string().regex(/^[0-9]{1,20}$/),
  z.uuid(),
  z.string().min(1).max(200),
  z.uuid(),
  z.uuid(),
  z.string().min(1).max(200),
  z.number().int().positive().refine(Number.isSafeInteger),
  z.literal('NGN'),
  z.string().min(1).max(200),
  z.string().min(1).max(200),
  z.enum(['bank', 'wallet']),
  z.string().min(1).max(200),
  z.string().min(1).max(200),
  z.string().min(1).max(200),
] as const;

export const transferSubmissionPostgresSchemas = {
  database: z.strictObject({
    host: z.literal('baci-isolated-savings-db-1'),
    port: z.literal(5432),
    database: z.literal('postgres'),
    role: z.literal('piggyvest_staging_submission_writer'),
    transport: z.literal('private-internal'),
    password: z.string().min(16).max(1024),
    expectedSystemId: z.string().regex(/^[0-9]{1,20}$/),
    businessId: z.string().min(1).max(200),
    integrationId: z.string().min(1).max(200),
  }),
  parameters: z.union([
    z.tuple(submissionParameters),
    z.tuple([
      ...submissionParameters,
      z.string().min(1).max(200),
      z.enum(['succeeded', 'failed']),
    ]),
  ]),
};
