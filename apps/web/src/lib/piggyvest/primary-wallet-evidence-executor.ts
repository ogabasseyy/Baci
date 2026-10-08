import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import { piggyvestPrimarySavingsTransferSchemas } from '@/schemas/piggyvest-primary-savings-transfer';

const statements = new Set([
  'SELECT piggyvest_primary.apply_inflow_environment($1::uuid,$2::text,$3::jsonb) AS result',
  'SELECT piggyvest_primary.read_dispatched_savings($1::uuid,$2::text,$3::uuid) AS result',
  'SELECT piggyvest_primary.settle_savings($1::uuid,$2::text,$3::jsonb) AS result',
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
    if (statement.includes('read_dispatched_savings'))
      piggyvestPrimarySavingsTransferSchemas.request.shape.operationId.parse(
        parameters[2]
      );
    else JSON.parse(parameters[2]);
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.login,
      password: config.database.password,
      ssl: {
        rejectUnauthorized: true,
        ca: config.database.certificateAuthority,
      },
      connectionTimeoutMillis: 4000,
      query_timeout: 4000,
      statement_timeout: 2500,
      lock_timeout: 1500,
      options: '-c search_path=pg_catalog',
      application_name: 'baci-piggyvest-primary-evidence',
    });
    try {
      await client.connect();
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
