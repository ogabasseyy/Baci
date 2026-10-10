import { isUint8Array } from 'node:util/types';
import { z } from 'zod';

const bytes = z
  .custom<Uint8Array>(isUint8Array)
  .refine((value) => value.byteLength <= 65_536);

export const piggyvestPostgresExecutionSchemas = {
  parameters: z
    .array(
      z.union([
        z
          .string()
          .max(65_536)
          .refine((value) => value.isWellFormed() && !value.includes('\0')),
        z.number().int().safe(),
        z.null(),
        bytes,
      ])
    )
    .max(11),
  session: z
    .array(
      z.strictObject({
        database_name: z.string(),
        role_name: z.string(),
        login_role: z.string(),
        is_superuser: z.literal(false),
        bypasses_rls: z.literal(false),
        creates_role: z.literal(false),
        creates_database: z.literal(false),
        replicates: z.literal(false),
        has_memberships: z.literal(false),
        fsync_enabled: z.literal('on'),
        synchronous_commit: z.literal('on'),
        is_replica: z.literal(false),
      })
    )
    .length(1),
  result: z.object({
    rows: z.array(z.unknown()).max(100),
    command: z.literal('SELECT'),
  }),
};
