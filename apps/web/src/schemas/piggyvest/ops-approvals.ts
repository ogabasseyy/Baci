import z from 'zod';

/**
 * Contracts for the two-person approvals CLI (tools/piggyvest-ops/approve.ts).
 * The database decides who may approve (SESSION_USER); these schemas only
 * keep the CLI's inputs and the rows it displays well-formed.
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

/** pg returns bigint as a string; amounts must be whole, non-negative and safe. */
const koboFromBigint = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})$/)
  .transform(Number)
  .refine(Number.isSafeInteger);

const timestamp = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

/** One row of piggyvest_approvals.list_open_ops_requests(). */
export const opsOpenRequestRowSchema = z
  .strictObject({
    request_id: z.uuid(),
    action: z.string().regex(/^[a-z][a-z_]{2,62}$/),
    label: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    amount_kobo: koboFromBigint,
    amount_naira: z.string().min(1).max(64),
    destination: z.string().min(1).max(200),
    reason: z.string().max(400).nullable(),
    requested_by: z.string().min(1).max(63),
    opened_at: timestamp,
    expires_at: timestamp,
    approvals: z.int().nonnegative(),
    decided_by_you: z.boolean(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .transform((row) => ({
    requestId: row.request_id,
    action: row.action,
    label: row.label,
    subject: row.subject,
    amountKobo: row.amount_kobo,
    destination: row.destination,
    reason: row.reason,
    requestedBy: row.requested_by,
    openedAt: row.opened_at,
    expiresAt: row.expires_at,
    approvals: row.approvals,
    decidedByYou: row.decided_by_you,
    digest: row.digest,
  }));

export type OpsOpenRequest = z.output<typeof opsOpenRequestRowSchema>;

/** The jsonb returned by piggyvest_approvals.approve_ops_request(). */
export const opsDecisionResultSchema = z
  .strictObject({
    request_id: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    approvals: z.int().nonnegative(),
    state: z.enum(['open', 'rejected']),
  })
  .transform((result) => ({
    requestId: result.request_id,
    decision: result.decision,
    approvals: result.approvals,
    state: result.state,
  }));
