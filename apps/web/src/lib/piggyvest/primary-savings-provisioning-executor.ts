import 'server-only';
import { Client } from 'pg';
import { primarySavingsProvisioningSchemas as schemas } from '@/schemas/primary-savings-provisioning';
import { PRIMARY_SAVINGS_PROVISIONING_STATEMENTS as statements } from './primary-savings-provisioning-store';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

const VERIFY_SESSION = `SELECT current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
    AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER, 'piggyvest_primary_goal_provisioner', 'MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members membership
      JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_primary_goal_provisioner')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimarySavingsProvisioningExecutor(
  configuration: unknown
): PiggyvestProvisioningExecutor {
  const config = schemas.runtime.parse(configuration).database;
  return async (statement, parameters) => {
    const count =
      statement === statements.prepare
        ? 3
        : statement === statements.read
          ? 2
          : statement === statements.record
            ? 4
            : statement === statements.enroll
              ? 3
              : null;
    if (
      count === null ||
      parameters.length !== count ||
      !parameters.every(
        (value, index) =>
          (typeof value === 'string' && value.length <= 4096) ||
          (statement === statements.record && index === 3 && value === null)
      )
    )
      throw new Error('Savings provisioning database unavailable');
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
      application_name: 'baci-primary-goal-wallet',
    });
    try {
      await client.connect();
      const result = await client.query<{
        database_name: string;
        login_name: string;
        role_name: string;
        safe: boolean;
        tls: boolean;
      }>(VERIFY_SESSION);
      const session = result.rows[0];
      if (
        result.rows.length !== 1 ||
        !session ||
        session.database_name !== config.name ||
        session.login_name !== config.login ||
        session.role_name !== config.login ||
        session.safe !== true ||
        session.tls !== true
      )
        throw new Error('Invalid session');
      const response = await client.query(statement, [...parameters]);
      return { rows: response.rows };
    } catch {
      throw new Error('Savings provisioning database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
