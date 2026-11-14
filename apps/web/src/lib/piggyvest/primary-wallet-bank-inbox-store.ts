import 'server-only';
import { Client } from 'pg';
import type { z } from 'zod';
import { primaryWalletBankInboxSchemas as schemas } from '@/schemas/primary-wallet-bank-inbox';
import { primaryDbLink } from './primary-db-link';
import { readPrimaryEngineReady } from './primary-wallet-engine-ready';

const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND role.rolvaliduntil>clock_timestamp()
    AND pg_has_role(SESSION_USER,$1::text,'MEMBER')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members membership JOIN pg_roles parent ON parent.oid=membership.roleid
      WHERE membership.member=role.oid AND parent.rolname<>$1::text)
    AND EXISTS(SELECT 1 FROM pg_roles parent WHERE parent.rolname=$1::text AND NOT parent.rolcanlogin
      AND NOT parent.rolsuper AND NOT parent.rolbypassrls AND NOT parent.rolcreaterole AND NOT parent.rolcreatedb AND NOT parent.rolreplication)) AS safe,
  piggyvest_primary.bank_role_safe($2::boolean) AS capability_safe,
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

type Action = keyof typeof statements | 'engineReady';

export function createPrimaryWalletBankInboxStore(configuration: unknown) {
  const config = schemas.runtime.parse(configuration);
  const intake = config.database.login === 'baci_primary_bank_intake';
  async function withVerifiedSession<T>(
    action: Action,
    run: (client: Client) => Promise<T>
  ): Promise<T> {
    // Engine readiness is a worker capability only: the intake login is
    // never granted the readiness reader.
    if (
      intake
        ? action !== 'readiness' && action !== 'enqueue'
        : action === 'enqueue'
    )
      throw new Error('Primary bank inbox capability unavailable');
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
      application_name: `baci-primary-bank-${intake ? 'intake' : 'worker'}`,
    });
    try {
      await client.connect();
      await link.afterConnect(client);
      // No validity-against-deadline pin: intake and worker drain
      // existing mappings past the deposit deadline, so role validity
      // must cover the drain window (extended operationally at
      // decommission, revoked after the drain). The session still fails
      // closed on expired validity, and the database pins the scope.
      const verified = await client.query(verify, [
        intake ? 'primary_bank_signed_intake' : 'primary_bank_inbox_worker',
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
      return await run(client);
    } catch {
      throw new Error('Primary bank inbox database unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  function execute(action: keyof typeof statements, command?: unknown) {
    return withVerifiedSession(action, async (client): Promise<unknown> => {
      const parameters = [
        config.integrationId,
        config.environment,
        JSON.stringify(config.scope),
      ];
      if (command !== undefined) parameters.push(JSON.stringify(command));
      const result = await client.query(statements[action], parameters);
      if (result.rows.length !== 1) throw new Error('Invalid acknowledgement');
      return result.rows[0]?.result;
    });
  }
  return {
    readiness: async () =>
      schemas.acknowledgement.parse(await execute('readiness')),
    // Fails closed: a readiness query error reads as not ready, while an
    // unsafe or unreachable session still throws like every other action.
    engineReady: () =>
      withVerifiedSession('engineReady', (client) =>
        readPrimaryEngineReady(
          (statement, parameters) => client.query(statement, [...parameters]),
          'bank_inbox'
        )
      ),
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
