import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';
import { GOAL_CANCEL_FORFEIT_STATEMENTS } from './goal-cancel-forfeit-statements';
import { GOAL_CANCEL_STATEMENTS } from './goal-cancel-statements';
import { GOAL_COMPLETE_STATEMENTS } from './goal-complete-statements';
import { primaryDbLink } from './primary-db-link';

const reserve =
  'SELECT piggyvest_primary.reserve_savings_with_pin($1::jsonb,$2::jsonb,$3::text) AS result';
const manage =
  'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result';
const read =
  'SELECT piggyvest_primary.read_savings_status($1::jsonb,$2::uuid) AS result';
const recover =
  'SELECT piggyvest_primary.read_pending_savings($1::jsonb,$2::uuid) AS result';
const adopt =
  'SELECT piggyvest_primary.adopt_pending_savings($1::jsonb,$2::uuid) AS result';
// Allowed statements and their exact parameter counts.
const parameterCounts = new Map<string, number>([
  [reserve, 3],
  [manage, 3],
  [read, 2],
  [recover, 2],
  [adopt, 2],
  [GOAL_CANCEL_STATEMENTS.issue, 2],
  [GOAL_CANCEL_STATEMENTS.reserve, 3],
  [GOAL_CANCEL_STATEMENTS.manage, 4],
  [GOAL_CANCEL_STATEMENTS.status, 2],
  [GOAL_CANCEL_STATEMENTS.checkIssued, 3],
  [GOAL_CANCEL_STATEMENTS.splitDispatch, 3],
  [GOAL_CANCEL_STATEMENTS.amounts, 2],
  [GOAL_CANCEL_FORFEIT_STATEMENTS.claim, 2],
  [GOAL_CANCEL_FORFEIT_STATEMENTS.manage, 3],
  [GOAL_CANCEL_FORFEIT_STATEMENTS.workerList, 4],
  [GOAL_CANCEL_FORFEIT_STATEMENTS.workerClaim, 3],
  [GOAL_CANCEL_FORFEIT_STATEMENTS.workerRelease, 3],
  [GOAL_COMPLETE_STATEMENTS.issue, 2],
  [GOAL_COMPLETE_STATEMENTS.reserve, 3],
  [GOAL_COMPLETE_STATEMENTS.manage, 4],
  [GOAL_COMPLETE_STATEMENTS.status, 2],
  [GOAL_COMPLETE_STATEMENTS.checkIssued, 3],
]);
// The goal cancel forfeit sweep (integration id, environment, selection).
const workerStatements = new Set<string>([
  GOAL_CANCEL_FORFEIT_STATEMENTS.workerList,
  GOAL_CANCEL_FORFEIT_STATEMENTS.workerClaim,
  GOAL_CANCEL_FORFEIT_STATEMENTS.workerRelease,
]);
const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,'piggyvest_primary_authorizer','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_primary_authorizer')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryWalletSavingsExecutor(configuration: unknown) {
  const config = piggyvestPrimarySavingsRuntimeSchema.parse(configuration);
  return async (
    statement: string,
    parameters: readonly string[]
  ): Promise<{ rows: unknown }> => {
    if (
      parameterCounts.get(statement) !== parameters.length ||
      parameters.some(
        (parameter) => typeof parameter !== 'string' || parameter.length > 8192
      )
    )
      throw new Error('Savings statement unavailable');
    if (workerStatements.has(statement)) {
      // Worker statements carry no customer scope: they are bound to this
      // integration and environment, and the database checks the login's
      // savings authority for it.
      if (
        parameters[0] !== config.integrationId ||
        parameters[1] !== config.environment
      )
        throw new Error('Savings binding unavailable');
    } else {
      const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(
        JSON.parse(parameters[0])
      );
      if (
        scope.integrationId !== config.integrationId ||
        scope.environment !== config.environment
      )
        throw new Error('Savings binding unavailable');
    }
    const link = primaryDbLink(config.database.login, config.database.port);
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: link.user,
      password: config.database.password,
      ssl: {
        rejectUnauthorized: true,
        ca: config.database.certificateAuthority,
        ...link.tls,
      },
      connectionTimeoutMillis: 4000,
      query_timeout: 4000,
      ...link.startup,
      application_name: 'baci-piggyvest-primary-savings',
    });
    try {
      await client.connect();
      await link.afterConnect(client);
      const result = await client.query(verify);
      const session = result.rows[0];
      if (
        result.rows.length !== 1 ||
        session?.database_name !== config.database.name ||
        session.login_name !== config.database.login ||
        session.role_name !== config.database.login ||
        session.safe !== true ||
        session.tls !== true
      )
        throw new Error('Unsafe session');
      const response = await client.query(statement, [...parameters]);
      return { rows: response.rows };
    } catch {
      throw new Error('Primary wallet savings database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
