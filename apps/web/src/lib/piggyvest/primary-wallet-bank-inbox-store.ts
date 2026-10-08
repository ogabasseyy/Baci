import 'server-only';
import { Client } from 'pg';
import type { z } from 'zod';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';

const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND role.rolvaliduntil>clock_timestamp() AND role.rolvaliduntil<=$2::timestamptz
    AND pg_has_role(SESSION_USER,$1::text,'MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>$1::text)
    AND EXISTS(SELECT 1 FROM pg_roles parent WHERE parent.rolname=$1::text AND NOT parent.rolcanlogin
      AND NOT parent.rolsuper AND NOT parent.rolbypassrls AND NOT parent.rolcreaterole AND NOT parent.rolcreatedb AND NOT parent.rolreplication)) AS safe,
  piggyvest_primary.bank_role_safe($3::boolean) AS capability_safe,
  EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls
  FROM pg_roles role WHERE role.rolname=SESSION_USER`;
const statements = {
  readiness:
    'SELECT piggyvest_primary.bank_inbox_readiness($1::uuid,$2::text,$3::jsonb) AS result',
  enqueue:
    'SELECT piggyvest_primary.enqueue_bank_inbox($1::uuid,$2::text,$3::jsonb,$4::jsonb) AS result',
  claim:
    'SELECT piggyvest_primary.claim_bank_inbox($1::uuid,$2::text,$3::jsonb,$4::jsonb) AS result',
  process:
    'SELECT piggyvest_primary.process_bank_inbox($1::uuid,$2::text,$3::jsonb,$4::jsonb) AS result',
  retry:
    'SELECT piggyvest_primary.retry_bank_inbox($1::uuid,$2::text,$3::jsonb,$4::jsonb) AS result',
};

export function createPrimaryWalletBankInboxStore(configuration: unknown) {
  const config = schemas.runtime.parse(configuration);
  const intake = config.database.login === 'baci_primary_bank_intake';
  async function execute(action: keyof typeof statements, command?: unknown) {
    if (
      intake
        ? action !== 'readiness' && action !== 'enqueue'
        : action === 'enqueue'
    )
      throw new Error('Primary bank inbox capability unavailable');
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
      application_name: `baci-primary-bank-${intake ? 'intake' : 'worker'}`,
    });
    try {
      await client.connect();
      const verified = await client.query(verify, [
        intake ? 'primary_bank_signed_intake' : 'primary_bank_inbox_worker',
        config.scope.expiresAt,
        !intake,
      ]);
      const session = verified.rows[0];
      if (
        verified.rows.length !== 1 ||
        session?.database_name !== config.database.name ||
        session.login_name !== config.database.login ||
        session.role_name !== config.database.login ||
        session.safe !== true ||
        session.capability_safe !== true ||
        session.tls !== true
      )
        throw new Error('Unsafe session');
      const parameters = [
        config.integrationId,
        config.environment,
        JSON.stringify(config.scope),
      ];
      if (command !== undefined) parameters.push(JSON.stringify(command));
      const result = await client.query(statements[action], parameters);
      if (result.rows.length !== 1) throw new Error('Invalid acknowledgement');
      const value: unknown = result.rows[0]?.result;
      return value;
    } catch {
      throw new Error('Primary bank inbox database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  return {
    readiness: async () =>
      schemas.acknowledgement.parse(await execute('readiness')),
    enqueue: async (command: z.infer<typeof schemas.enqueue>) =>
      schemas.intake.parse(
        await execute('enqueue', schemas.enqueue.parse(command))
      ),
    claim: async (command: z.infer<typeof schemas.batch>) =>
      schemas.claims.parse(
        await execute('claim', schemas.batch.parse(command))
      ),
    process: async (command: z.infer<typeof schemas.process>) =>
      schemas.result.parse(
        await execute('process', schemas.process.parse(command))
      ),
    retry: async (command: z.infer<typeof schemas.retry>) =>
      schemas.acknowledgement.parse(
        await execute('retry', schemas.retry.parse(command))
      ),
  };
}
