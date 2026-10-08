import 'server-only';
import { Client } from 'pg';
import type { z } from 'zod';
import { primaryWalletPaidInterestSchemas as schemas } from '@/schemas/primary-wallet-paid-interest';

const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,'piggyvest_primary_evidence','MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>'piggyvest_primary_evidence')) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryWalletPaidInterestStore(configuration: unknown) {
  const config = schemas.runtime.parse(configuration);
  async function execute(
    kind:
      | 'read_paid_interest_crosswalk'
      | 'apply_paid_interest'
      | 'paid_interest_event_involved',
    selection: unknown
  ) {
    const value = JSON.stringify(selection);
    if (value.length > 8192)
      throw new Error('Primary interest selection unavailable');
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
      application_name: 'baci-primary-paid-interest',
    });
    try {
      await client.connect();
      const verified = await client.query(verify);
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
        `SELECT piggyvest_primary.${kind}($1::uuid,$2::text,$3::jsonb) AS result`,
        [config.integrationId, config.environment, value]
      );
      if (result.rows.length !== 1) throw new Error('Invalid acknowledgement');
      const outcome: unknown = result.rows[0]?.result;
      return outcome;
    } catch {
      throw new Error('Primary paid-interest database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  return {
    async involved(selection: z.infer<typeof schemas.selection>) {
      const value = await execute(
        'paid_interest_event_involved',
        schemas.selection.parse(selection)
      );
      return value === true;
    },
    async resolveCrosswalk(selection: z.infer<typeof schemas.selection>) {
      const value = await execute(
        'read_paid_interest_crosswalk',
        schemas.selection.parse(selection)
      );
      return value === null ? null : schemas.crosswalk.parse(value);
    },
    async apply(proof: z.infer<typeof schemas.proof>) {
      return schemas.outcome.parse(
        await execute('apply_paid_interest', schemas.proof.parse(proof))
      );
    },
  };
}
