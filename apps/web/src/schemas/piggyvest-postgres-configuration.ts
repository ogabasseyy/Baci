import { z } from 'zod';

const role = z.enum([
  'piggyvest_staging_intake',
  'piggyvest_staging_worker',
  'piggyvest_staging_provisioner',
  'piggyvest_staging_ledger_worker',
  'piggyvest_staging_policy_writer',
]);
const host = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
const common = {
  environment: z.literal('staging'),
  role,
  port: z.number().int().min(1).max(65535),
};

export const piggyvestPostgresConfigurationSchema = z.discriminatedUnion(
  'transport',
  [
    z.strictObject({
      ...common,
      transport: z.literal('local_test'),
      socketDirectory: z
        .string()
        .regex(
          /^\/(?:private\/)?tmp\/baci-piggyvest-runtime\.[A-Za-z0-9]+\/socket$/
        ),
      database: z.literal('piggyvest_local'),
      password: z.literal('synthetic-local-only'),
    }),
    z
      .strictObject({
        ...common,
        transport: z.literal('tls'),
        host,
        expectedHost: host,
        database: z
          .string()
          .min(1)
          .max(63)
          .regex(/^[a-z][a-z0-9_]*$/),
        password: z
          .string()
          .min(1)
          .max(4096)
          .refine((value) => !value.includes('\0')),
        storageApproved: z.literal(true),
        expectedProjectId: z.string().min(1).max(128),
        actualProjectId: z.string().min(1).max(128),
        certificateAuthority: z.string().min(1).max(32_768).optional(),
      })
      .refine(
        (input) =>
          input.role !== 'piggyvest_staging_policy_writer' &&
          input.host === input.expectedHost &&
          input.actualProjectId === input.expectedProjectId
      ),
  ]
);
