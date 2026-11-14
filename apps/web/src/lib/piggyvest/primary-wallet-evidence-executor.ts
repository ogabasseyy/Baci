import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';
import { GOAL_CANCEL_FORFEIT_STATEMENTS } from './goal-cancel-forfeit-statements';
import { GOAL_CANCEL_STATEMENTS } from './goal-cancel-statements';
import { GOAL_COMPLETE_STATEMENTS } from './goal-complete-statements';
import { primaryDbLink } from './primary-db-link';

const statements = new Set([
  'SELECT piggyvest_primary.apply_inflow_environment($1::uuid,$2::text,$3::jsonb) AS result',
  'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result',
  'SELECT piggyvest_primary.find_dispatched_savings_by_reference($1::uuid,$2::text,$3::text) AS result',
  'SELECT piggyvest_primary.settle_savings($1::uuid,$2::text,$3::jsonb) AS result',
  'SELECT piggyvest_primary.release_failed_savings($1::uuid,$2::text,$3::jsonb) AS result',
  GOAL_CANCEL_STATEMENTS.readDispatched,
  GOAL_CANCEL_STATEMENTS.findByReference,
  GOAL_CANCEL_STATEMENTS.settle,
  GOAL_CANCEL_STATEMENTS.release,
  GOAL_CANCEL_FORFEIT_STATEMENTS.readDispatched,
  GOAL_CANCEL_FORFEIT_STATEMENTS.findByReference,
  GOAL_CANCEL_FORFEIT_STATEMENTS.settle,
  GOAL_CANCEL_FORFEIT_STATEMENTS.release,
  GOAL_CANCEL_FORFEIT_STATEMENTS.ack,
  GOAL_COMPLETE_STATEMENTS.readDispatched,
  GOAL_COMPLETE_STATEMENTS.findByReference,
  GOAL_COMPLETE_STATEMENTS.settle,
  GOAL_COMPLETE_STATEMENTS.release,
  GOAL_COMPLETE_STATEMENTS.readPurchaseAlert,
  GOAL_COMPLETE_STATEMENTS.markPurchaseAlerted,
  'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result',
  'SELECT piggyvest_primary.read_credit_gap_ledger($1::uuid,$2::text,$3::jsonb) AS result',
]);
// Statements whose third parameter is an operation id (not JSON).
const operationIdStatements = new Set<string>([
  GOAL_CANCEL_STATEMENTS.readDispatched,
  GOAL_CANCEL_FORFEIT_STATEMENTS.readDispatched,
  GOAL_CANCEL_FORFEIT_STATEMENTS.ack,
  GOAL_COMPLETE_STATEMENTS.readDispatched,
  GOAL_COMPLETE_STATEMENTS.readPurchaseAlert,
  GOAL_COMPLETE_STATEMENTS.markPurchaseAlerted,
]);
const referenceStatements = new Set<string>([
  GOAL_CANCEL_STATEMENTS.findByReference,
  GOAL_CANCEL_FORFEIT_STATEMENTS.findByReference,
  GOAL_COMPLETE_STATEMENTS.findByReference,
]);
const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,'piggyvest_primary_evidence','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_primary_evidence')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryWalletEvidenceExecutor(configuration: unknown) {
  const config = piggyvestPrimaryInflowRuntimeSchema.parse(configuration);
  return async (
    statement: string,
    parameters: readonly string[]
  ): Promise<{ rows: unknown }> => {
    if (
      !statements.has(statement) ||
      parameters.length !== 3 ||
      parameters[0] !== config.integrationId ||
      parameters[1] !== config.environment ||
      parameters.some(
        (parameter) => typeof parameter !== 'string' || parameter.length > 8192
      )
    )
      throw new Error('Primary wallet evidence statement unavailable');
    if (
      operationIdStatements.has(statement) ||
      statement.includes('read_dispatched_savings')
    )
      piggyvestPrimarySavingsTransferSchemas.request.shape.operationId.parse(
        parameters[2]
      );
    else if (
      referenceStatements.has(statement) ||
      statement.includes('find_dispatched_savings_by_reference')
    )
      piggyvestPrimarySavingsTransferSchemas.reserved.shape.reference.parse(
        parameters[2]
      );
    else JSON.parse(parameters[2]);
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
      application_name: 'baci-piggyvest-primary-evidence',
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
      throw new Error('Primary wallet evidence database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
