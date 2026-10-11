import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimarySavingsRuntimeSchema } from '@/schemas/piggyvest-primary-savings-runtime';
import { piggyvestPrimaryWalletStoreSchemas } from '@/schemas/piggyvest-primary-wallet-store';

const reserve =
  'SELECT piggyvest_primary.reserve_savings($1::jsonb,$2::jsonb) AS result';
const manage =
  'SELECT piggyvest_primary.manage_savings($1::jsonb,$2::uuid,$3::text) AS result';
const read =
  'SELECT piggyvest_primary.read_savings_status($1::jsonb,$2::uuid) AS result';
const recover =
  'SELECT piggyvest_primary.read_pending_savings($1::jsonb,$2::uuid) AS result';
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
      (statement !== reserve &&
        statement !== manage &&
        statement !== read &&
        statement !== recover) ||
      parameters.length !== (statement === manage ? 3 : 2) ||
      parameters.some(
        (parameter) => typeof parameter !== 'string' || parameter.length > 8192
      )
    )
      throw new Error('Savings statement unavailable');
    const scope = piggyvestPrimaryWalletStoreSchemas.scope.parse(
      JSON.parse(parameters[0])
    );
    if (
      scope.integrationId !== config.integrationId ||
      scope.environment !== config.environment
    )
      throw new Error('Savings binding unavailable');
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
      application_name: 'baci-piggyvest-primary-savings',
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
      throw new Error('Primary wallet savings database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
