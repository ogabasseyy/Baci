import { z } from 'zod';

export const prefundedCardExecutorProfileSchema = z.enum([
  'customer',
  'worker',
  'authorizer',
  'evidence',
  'reversal',
  'checkout_customer',
  'checkout_authorizer',
]);

const profileLogin = {
  customer: 'prefunded_treasury_operator',
  worker: 'prefunded_treasury_operator',
  authorizer: 'prefunded_authorizer',
  evidence: 'prefunded_evidence',
  reversal: 'prefunded_treasury_operator',
  checkout_customer: 'prefunded_treasury_operator',
  checkout_authorizer: 'prefunded_authorizer',
} as const;

const login = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const systemIdentifier = z.string().regex(/^[0-9]{1,20}$/);
const common = {
  environment: z.literal('staging'),
  profile: prefundedCardExecutorProfileSchema,
  port: z.number().int().min(1).max(65535),
  login,
  expectedLogin: login,
  database: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  expectedDatabase: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  expectedSystemId: systemIdentifier,
};

const localTest = z.strictObject({
  ...common,
  transport: z.literal('local_test'),
  socketDirectory: z
    .string()
    .regex(
      /^\/(?:private\/)?tmp\/baci-prefunded-card-executor\.[A-Za-z0-9]+\/socket$/
    ),
  password: z.literal('synthetic-local-only'),
});

const tls = z.strictObject({
  ...common,
  transport: z.literal('tls'),
  host: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
  expectedHost: z
    .string()
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
  password: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes('\0')),
  storageApproved: z.literal(true),
  expectedProjectId: z.string().min(1).max(128),
  actualProjectId: z.string().min(1).max(128),
  certificateAuthority: z.string().min(1).max(32_768).optional(),
});

export const prefundedCardPostgresExecutorSchema = z
  .discriminatedUnion('transport', [localTest, tls])
  .refine(
    (configuration) =>
      configuration.login === configuration.expectedLogin &&
      configuration.database === configuration.expectedDatabase &&
      configuration.login === profileLogin[configuration.profile] &&
      (configuration.transport === 'local_test' ||
        (configuration.host === configuration.expectedHost &&
          configuration.actualProjectId === configuration.expectedProjectId)),
    'Prefunded card database unavailable'
  );

const membership = z.strictObject({
  role_name: z.string(),
  admin_option: z.literal(false),
  can_login: z.literal(false),
  is_superuser: z.literal(false),
  bypasses_rls: z.literal(false),
  creates_role: z.literal(false),
  creates_database: z.literal(false),
  replicates: z.literal(false),
});

export const prefundedCardPostgresExecutorSchemas = {
  parameterText: z
    .string()
    .max(65_536)
    .refine((value) => value.isWellFormed() && !value.includes('\0')),
  identity: z
    .array(
      z.strictObject({
        result: z.strictObject({
          database: z.string(),
          login: z.string(),
          systemIdentifier,
        }),
      })
    )
    .length(1),
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
        can_login: z.literal(true),
        inherits_privileges: z.literal(false),
        memberships: z.array(membership).max(3),
        inherited_memberships: z.array(z.string()).length(0),
        fsync_enabled: z.literal('on'),
        synchronous_commit: z.literal('on'),
        is_replica: z.literal(false),
      })
    )
    .length(1),
  result: z.strictObject({
    rows: z.array(z.unknown()).max(100),
    command: z.literal('SELECT'),
  }),
};
