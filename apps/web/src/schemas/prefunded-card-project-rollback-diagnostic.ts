import { z } from 'zod';
import { prefundedCardReadOperationDiagnosticSchemas as readSchemas } from './prefunded-card-read-operation-diagnostic';

const phase = z.enum([
  'arguments',
  'configuration',
  'connect',
  'begin',
  'begin-validation',
  'identity-query',
  'identity-validation',
  'session-query',
  'session-validation',
  'operation',
  'result-validation',
  'constraints',
  'rollback',
  'rollback-validation',
  'close',
  'deadline',
]);
const code = z.union([
  readSchemas.diagnostic.shape.code,
  z.enum([
    '23503',
    '23514',
    '23505',
    'P0001',
    '25000',
    '25P02',
    '55P03',
    '40P01',
  ]),
]);
const settings = {
  deadlineMs: 5000,
  connectTimeoutMs: 1500,
  queryTimeoutMs: 2500,
  startupOptions:
    '-c search_path=pg_catalog -c statement_timeout=2000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=3000 -c synchronous_commit=on',
  identity: 'SELECT prefunded_card.executor_system_identity() AS result',
  session:
    "SELECT current_database() AS database_name, current_user AS role_name, session_user AS login_role, login.rolsuper AS is_superuser, login.rolbypassrls AS bypasses_rls, login.rolcreaterole AS creates_role, login.rolcreatedb AS creates_database, login.rolreplication AS replicates, login.rolcanlogin AS can_login, login.rolinherit AS inherits_privileges, COALESCE(jsonb_agg(DISTINCT jsonb_build_object('role_name', granted.rolname, 'admin_option', membership.admin_option, 'can_login', granted.rolcanlogin, 'is_superuser', granted.rolsuper, 'bypasses_rls', granted.rolbypassrls, 'creates_role', granted.rolcreaterole, 'creates_database', granted.rolcreatedb, 'replicates', granted.rolreplication)) FILTER (WHERE granted.oid IS NOT NULL), '[]'::jsonb) AS memberships, COALESCE(jsonb_agg(DISTINCT inherited.rolname) FILTER (WHERE inherited.oid IS NOT NULL), '[]'::jsonb) AS inherited_memberships, current_setting('fsync') AS fsync_enabled, current_setting('synchronous_commit') AS synchronous_commit, pg_is_in_recovery() AS is_replica FROM pg_catalog.pg_roles login LEFT JOIN pg_catalog.pg_auth_members membership ON membership.member = login.oid LEFT JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid LEFT JOIN pg_catalog.pg_auth_members nested ON nested.member = granted.oid LEFT JOIN pg_catalog.pg_roles inherited ON inherited.oid = nested.roleid WHERE login.rolname = current_user GROUP BY login.oid, login.rolsuper, login.rolbypassrls, login.rolcreaterole, login.rolcreatedb, login.rolreplication, login.rolcanlogin, login.rolinherit",
  begin: 'BEGIN ISOLATION LEVEL READ COMMITTED',
  project: 'SELECT prefunded_card.project($1::uuid,$2::text) AS result',
  constraints: 'SET CONSTRAINTS ALL IMMEDIATE',
  rollback: 'ROLLBACK',
  memberships: [
    'prefunded_card_authorization_reader',
    'prefunded_treasury_ledger_worker',
  ],
} as const;
const common = {
  redacted: z.literal(true),
  financialCommitted: z.literal(false),
  newPaymentStarted: z.literal(false),
};

export const prefundedCardProjectRollbackDiagnosticSchemas = {
  pins: { ...readSchemas.pins, deadline: '2026-10-06T15:59:10Z' } as const,
  arguments: readSchemas.arguments,
  settings,
  phase,
  code,
  report: z.discriminatedUnion('status', [
    z.strictObject({
      ...common,
      status: z.literal('project-rollback-validated'),
      outcome: z.enum(['applied', 'duplicate', 'deferred']),
      rollbackConfirmed: z.literal(true),
      constraintsValidated: z.literal(true),
      connectionClosed: z.literal(true),
    }),
    z.strictObject({
      ...common,
      status: z.literal('project-rollback-refused'),
      rollbackConfirmed: z.boolean(),
      constraintsValidated: z.boolean(),
      connectionClosed: z.boolean(),
      diagnostic: z.strictObject({
        profile: z.literal('worker'),
        phase,
        code,
      }),
    }),
  ]),
};
