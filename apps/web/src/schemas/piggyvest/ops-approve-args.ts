import z from 'zod';

/**
 * Command-line arguments of the two-person approvals CLI
 * (tools/piggyvest-ops/approve.ts). The database decides who may approve
 * (SESSION_USER); this only keeps the CLI's inputs well-formed.
 */

const RESERVED_LOGINS = new Set([
  'postgres',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'authenticator',
  'anon',
  'authenticated',
  'service_role',
  'piggyvest_primary_approver',
]);

/** A personal approver LOGIN, created by the owner (never a shared or API role). */
const opsApproverLoginSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,62}$/)
  .refine((login) => !RESERVED_LOGINS.has(login), 'Use your personal login');

/** The login itself, or the Supabase session-pooler form "login.<project ref>". */
const connectionUserSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,62}(?:\.[a-z0-9]{20})?$/)
  .refine(
    (user) => opsApproverLoginSchema.safeParse(user.split('.')[0]).success,
    'Use your personal login'
  );

/** A bare host name or IP address: never a connection string or credentials. */
const hostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9-]+$|^::1$/
  );

export const opsApproveArgsSchema = z
  .strictObject({
    host: hostSchema,
    port: z.int().min(1).max(65_535),
    database: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    user: connectionUserSchema,
    request: z.uuid().optional(),
    caFile: z.string().min(1).max(4096).optional(),
    reject: z.boolean(),
    commit: z.boolean(),
    help: z.boolean(),
  })
  .refine(
    (args) => args.request !== undefined || (!args.commit && !args.reject),
    { message: '--commit and --reject need --request <id>' }
  );

export type OpsApproveArgs = z.infer<typeof opsApproveArgsSchema>;
