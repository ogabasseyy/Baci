import 'server-only';
import { Client } from 'pg';
import { piggyvestPrimaryWalletRuntimeSchema } from '@/schemas/piggyvest-primary-wallet-runtime';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import { PRIMARY_WALLET_VERIFICATION_STATEMENT } from './primary-wallet-verification';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

const VERIFY_SESSION = `SELECT current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
    AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER, 'piggyvest_primary_provisioner', 'MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE membership.member = role.oid AND parent.rolname <> 'piggyvest_primary_provisioner')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname = SESSION_USER`;

export function createPrimaryWalletExecutor(
  configuration: unknown
): PiggyvestProvisioningExecutor {
  const config =
    piggyvestPrimaryWalletRuntimeSchema.parse(configuration).database;
  return async (statement, parameters) => {
    const expectedCount =
      statement === PRIMARY_WALLET_STATEMENTS.read
        ? 1
        : statement === PRIMARY_WALLET_STATEMENTS.claim ||
            statement === PRIMARY_WALLET_VERIFICATION_STATEMENT
          ? 2
          : statement === PRIMARY_WALLET_STATEMENTS.record
            ? 5
            : statement === PRIMARY_WALLET_STATEMENTS.uncertain
              ? 3
              : null;
    if (
      expectedCount === null ||
      parameters.length !== expectedCount ||
      !parameters.every(
        (value) => typeof value === 'string' && value.length <= 4096
      )
    ) {
      throw new Error('Primary wallet database unavailable');
    }
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.name,
      user: config.login,
      password: config.password,
      ssl: { rejectUnauthorized: true, ca: config.certificateAuthority },
      connectionTimeoutMillis: 4000,
      query_timeout: 4000,
      statement_timeout: 2500,
      lock_timeout: 1500,
      options: '-c search_path=pg_catalog',
      application_name: 'baci-piggyvest-primary',
    });
    try {
      await client.connect();
      const verification = await client.query<{
        database_name: string;
        login_name: string;
        role_name: string;
        safe: boolean;
        tls: boolean;
      }>(VERIFY_SESSION);
      const session = verification.rows[0];
      if (
        verification.rows.length !== 1 ||
        !session ||
        session.database_name !== config.name ||
        session.login_name !== config.login ||
        session.role_name !== config.login ||
        session.safe !== true ||
        session.tls !== true
      ) {
        throw new Error('Invalid session');
      }
      const result = await client.query(statement, [...parameters]);
      return { rows: result.rows };
    } catch {
      throw new Error('Primary wallet database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
