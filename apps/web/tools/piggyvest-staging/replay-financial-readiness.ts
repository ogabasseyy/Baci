import { Client } from 'pg';
import { replayFinancialSchemas } from './schemas/replay-financial';

const sessionStatement = `SELECT session_user AS login, current_user AS role,
  current_database() AS database, current_setting('transaction_read_only') AS read_only,
  (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,
  (SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
    FROM pg_roles WHERE rolname=current_user) AS unsafe`;
const identityStatement =
  'SELECT prefunded_card.executor_system_identity() AS result';
const authorityStatement = `SELECT has_schema_privilege(current_user,
  'piggyvest_savings_ledger','USAGE') AND CASE WHEN to_regprocedure(
  'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)') IS NULL
  THEN false ELSE has_function_privilege(current_user, to_regprocedure(
  'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'),
  'EXECUTE') END AS authorized`;

interface Session {
  login: unknown;
  role: unknown;
  database: unknown;
  read_only: unknown;
  ssl: unknown;
  unsafe: unknown;
}

export async function checkFinancialReplayReadiness(
  configuration: unknown,
  expectedSystemId: string
): Promise<'ready' | 'transport-unavailable' | 'authority-unavailable'> {
  const parsed = replayFinancialSchemas.database.safeParse(configuration);
  if (
    !parsed.success ||
    parsed.data.role !== 'prefunded_treasury_operator' ||
    !/^[0-9]{1,20}$/.test(expectedSystemId)
  )
    return 'transport-unavailable';
  const config = parsed.data;
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.role,
    password: config.password,
    ssl: { ca: config.ssl.ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 3000,
    query_timeout: 10000,
    statement_timeout: 8000,
    idle_in_transaction_session_timeout: 12000,
    application_name: 'baci-staging-interest-readiness',
  });
  let disconnected = false;
  client.on('error', () => {
    disconnected = true;
  });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const sessions = await client.query<Session>(sessionStatement);
    const session = sessions.rows[0];
    if (
      sessions.rows.length !== 1 ||
      session?.login !== config.role ||
      session.role !== config.role ||
      session.database !== config.database ||
      session.read_only !== 'on' ||
      session.ssl !== true ||
      session.unsafe !== false
    )
      return 'transport-unavailable';
    const identities = await client.query<{ result: unknown }>(
      identityStatement
    );
    const identity = identities.rows[0]?.result;
    if (
      identities.rows.length !== 1 ||
      typeof identity !== 'object' ||
      identity === null ||
      !('systemIdentifier' in identity) ||
      identity.systemIdentifier !== expectedSystemId ||
      !('login' in identity) ||
      identity.login !== config.role ||
      !('database' in identity) ||
      identity.database !== config.database
    )
      return 'transport-unavailable';
    const authority = await client.query<{ authorized: unknown }>(
      authorityStatement
    );
    if (
      authority.rows.length !== 1 ||
      typeof authority.rows[0]?.authorized !== 'boolean' ||
      disconnected
    )
      return 'transport-unavailable';
    return authority.rows[0].authorized ? 'ready' : 'authority-unavailable';
  } catch {
    return 'transport-unavailable';
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
