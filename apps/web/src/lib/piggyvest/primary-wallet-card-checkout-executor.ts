import 'server-only';
import { Client } from 'pg';
import { primaryWalletCardCheckoutRuntimeSchema } from '@/schemas/primary-wallet-card-checkout-runtime';

const statements = {
  reserve: {
    role: 'authorizer',
    sql: 'SELECT piggyvest_primary_card.reserve($1::jsonb,$2::jsonb) AS result',
    count: 2,
  },
  read: {
    role: 'authorizer',
    sql: 'SELECT piggyvest_primary_card.read_operation($1::jsonb,$2::uuid) AS result',
    count: 2,
  },
  claim: {
    role: 'authorizer',
    sql: 'SELECT piggyvest_primary_card.claim_initialization($1::jsonb,$2::uuid) AS result',
    count: 2,
  },
  initialize: {
    role: 'authorizer',
    sql: 'SELECT piggyvest_primary_card.record_initialization($1::jsonb,$2::uuid,$3::uuid,$4::jsonb) AS result',
    count: 4,
  },
  collection: {
    role: 'evidence',
    sql: 'SELECT piggyvest_primary_card.record_collection($1::jsonb,$2::uuid,$3::jsonb) AS result',
    count: 3,
  },
  reconciliation: {
    role: 'evidence',
    sql: 'SELECT piggyvest_primary_card.flag_reconciliation($1::jsonb,$2::uuid) AS result',
    count: 2,
  },
  abandonment: {
    role: 'evidence',
    sql: 'SELECT piggyvest_primary_card.record_abandonment($1::jsonb,$2::uuid) AS result',
    count: 2,
  },
  reversal: {
    role: 'evidence',
    sql: 'SELECT piggyvest_primary_card.record_checkout_reversal($1::jsonb,$2::uuid,$3::text,$4::text,$5::jsonb) AS result',
    count: 5,
  },
  selectStaleReady: {
    role: 'evidence',
    sql: 'SELECT piggyvest_primary_card.select_stale_ready_checkouts($1::jsonb,$2::timestamptz,$3::integer) AS result',
    count: 3,
  },
} as const;

const verifySession = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_has_role(SESSION_USER,$1,'MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_roles parent
      WHERE parent.rolname NOT IN (SESSION_USER,$1) AND pg_has_role(SESSION_USER,parent.oid,'MEMBER'))
    AND NOT EXISTS(SELECT 1 FROM pg_roles capability WHERE capability.rolname=$1
      AND (capability.rolsuper OR capability.rolbypassrls OR capability.rolcreaterole OR capability.rolcreatedb OR capability.rolreplication))) AS safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryWalletCardCheckoutExecutor(
  configuration: unknown
) {
  const config = primaryWalletCardCheckoutRuntimeSchema.parse(configuration);
  return async (
    action: keyof typeof statements,
    parameters: readonly (string | null)[]
  ): Promise<unknown> => {
    const statement = statements[action];
    if (
      !statement ||
      parameters.length !== statement.count ||
      parameters.some(
        (value) =>
          value !== null && (typeof value !== 'string' || value.length > 8192)
      )
    )
      throw new Error('Primary card storage unavailable');
    const database = config[statement.role];
    const client = new Client({
      host: database.host,
      port: database.port,
      database: database.name,
      user: database.login,
      password: database.password,
      ssl: { rejectUnauthorized: true, ca: database.certificateAuthority },
      connectionTimeoutMillis: 4000,
      query_timeout: 4000,
      statement_timeout: 2500,
      lock_timeout: 1500,
      options: '-c search_path=pg_catalog',
      application_name: 'baci-primary-card-checkout',
    });
    try {
      await client.connect();
      const verified = await client.query(verifySession, [
        `primary_card_${statement.role}`,
      ]);
      const session = verified.rows[0];
      if (
        verified.rows.length !== 1 ||
        session?.database_name !== database.name ||
        session.login_name !== database.login ||
        session.role_name !== database.login ||
        session.safe !== true ||
        session.tls !== true
      )
        throw new Error('Unsafe session');
      const result = await client.query(statement.sql, [...parameters]);
      if (result.rows.length !== 1) throw new Error('Invalid acknowledgement');
      return result.rows[0]?.result;
    } catch {
      throw new Error('Primary card storage unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
