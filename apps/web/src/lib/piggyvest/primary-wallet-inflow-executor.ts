import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimaryInflowRuntimeSchema } from '@/schemas/piggyvest-primary-inflow-runtime';
import type { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';

type Receipt = ReturnType<typeof preparePrimaryWalletInflowReceipt> & {
  bodyDigest: string;
};
const VERIFY = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,'piggyvest_primary_evidence','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_primary_evidence')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryWalletInflowExecutor(configuration: unknown) {
  const config = piggyvestPrimaryInflowRuntimeSchema.parse(configuration);
  return async (
    receipt: Receipt
  ): Promise<'credited' | 'duplicate' | 'unmapped' | 'conflict'> => {
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
      application_name: 'baci-piggyvest-primary-inflow',
    });
    try {
      await client.connect();
      const verified = await client.query(VERIFY);
      const session = verified.rows[0];
      if (
        verified.rows.length !== 1 ||
        session?.database_name !== config.database.name ||
        session.login_name !== config.database.login ||
        session.role_name !== config.database.login ||
        session.safe !== true ||
        session.tls !== true
      )
        throw new Error('Unsafe session');
      const result = await client.query(
        'SELECT piggyvest_primary.apply_inflow_environment($1::uuid,$2::text,$3::jsonb) AS result',
        [config.integrationId, config.environment, JSON.stringify(receipt)]
      );
      const outcome: unknown = result.rows[0]?.result;
      if (
        result.rows.length !== 1 ||
        (outcome !== 'credited' &&
          outcome !== 'duplicate' &&
          outcome !== 'unmapped' &&
          outcome !== 'conflict')
      )
        throw new Error('Invalid acknowledgement');
      return outcome;
    } catch {
      throw new Error('Primary wallet inflow database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
