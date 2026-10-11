import 'server-only';
import { Client } from 'pg';
import { primaryWalletCardCustodySchemas as schemas } from '@/schemas/primary-wallet-card-custody';
import { primaryCardCustodyInboxSchemas as inboxSchemas } from '@/schemas/primary-wallet-card-custody-inbox';
import { primaryCardTransferProviderSchemas as transferSchemas } from '@/schemas/primary-wallet-card-transfer-provider';

const statements = {
  selectReadyTransfers: {
    role: 'transfer',
    capability: 'primary_card_transfer_worker',
    sql: 'SELECT piggyvest_primary_card.select_ready_transfers($1::uuid,$2::text,$3::jsonb,$4::integer) AS result',
    count: 2,
  },
  dispatchContext: {
    role: 'transfer',
    capability: 'primary_card_transfer_worker',
    sql: 'SELECT piggyvest_primary_card.dispatch_context($1::uuid,$2::text,$3::uuid,$4::jsonb) AS result',
    count: 2,
  },
  claim: {
    role: 'transfer',
    capability: 'primary_card_transfer_worker',
    sql: 'SELECT piggyvest_primary_card.claim_transfer($1::uuid,$2::text,$3::uuid) AS result',
    count: 1,
  },
  record: {
    role: 'transfer',
    capability: 'primary_card_transfer_worker',
    sql: 'SELECT piggyvest_primary_card.record_transfer($1::uuid,$2::text,$3::uuid,$4::uuid,$5::boolean) AS result',
    count: 3,
  },
  requeue: {
    role: 'transfer',
    capability: 'primary_card_transfer_worker',
    sql: 'SELECT piggyvest_primary_card.requeue_transfer($1::uuid,$2::text,$3::uuid,$4::uuid) AS result',
    count: 2,
  },
  context: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.transfer_context($1::uuid,$2::text,$3::uuid) AS result',
    count: 1,
  },
  settle: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.settle_custody($1::uuid,$2::text,$3::jsonb) AS result',
    count: 1,
  },
  inboxReadiness: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.signed_inbox_readiness($1::uuid,$2::text,$3::jsonb) AS result',
    count: 1,
  },
  inboxEnqueue: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.enqueue_signed_inbox($1::uuid,$2::text,$3::jsonb,$4::text,$5::text) AS result',
    count: 3,
  },
  inboxClaim: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.claim_signed_inbox($1::uuid,$2::text,$3::jsonb,$4::integer) AS result',
    count: 2,
  },
  inboxResolve: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.resolve_signed_reference($1::uuid,$2::text,$3::jsonb,$4::text,$5::text) AS result',
    count: 3,
  },
  inboxFinish: {
    role: 'custody',
    capability: 'primary_card_custody_evidence',
    sql: 'SELECT piggyvest_primary_card.finish_signed_inbox($1::uuid,$2::text,$3::jsonb,$4::text,$5::uuid,$6::text) AS result',
    count: 4,
  },
} as const;
const verify = `SELECT current_database() AS database_name, SESSION_USER AS login_name, CURRENT_USER AS role_name,
 (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole AND NOT role.rolcreatedb AND NOT role.rolreplication
 AND pg_has_role(SESSION_USER,$1,'MEMBER') AND NOT EXISTS(SELECT 1 FROM pg_roles parent WHERE parent.rolname NOT IN(SESSION_USER,$1) AND pg_has_role(SESSION_USER,parent.oid,'MEMBER'))
 AND NOT EXISTS(SELECT 1 FROM pg_roles capability WHERE capability.rolname=$1 AND (capability.rolsuper OR capability.rolbypassrls OR capability.rolcreaterole OR capability.rolcreatedb OR capability.rolreplication))) AS safe,
 EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls FROM pg_roles role WHERE role.rolname=SESSION_USER`;

export function createPrimaryCardCustodyExecutor(configuration: unknown) {
  const config = schemas.runtime
    .or(inboxSchemas.intakeRuntime)
    .or(transferSchemas.runtime)
    .parse(configuration);
  return async (
    action: keyof typeof statements,
    parameters: readonly (string | boolean)[]
  ): Promise<unknown> => {
    const selected = statements[action];
    if (
      'transferOnly' in config &&
      ![
        'selectReadyTransfers',
        'dispatchContext',
        'claim',
        'record',
        'requeue',
      ].includes(action)
    )
      throw new Error('Custody storage unavailable');
    if (
      'intakeOnly' in config &&
      action !== 'inboxReadiness' &&
      action !== 'inboxEnqueue'
    )
      throw new Error('Custody storage unavailable');
    if (
      !selected ||
      parameters.length !== selected.count ||
      parameters.some(
        (value) =>
          (typeof value !== 'string' && typeof value !== 'boolean') ||
          (typeof value === 'string' &&
            value.length > (action === 'inboxEnqueue' ? 131072 : 16384))
      )
    )
      throw new Error('Custody storage unavailable');
    const database =
      selected.role === 'custody'
        ? 'custody' in config
          ? config.custody
          : null
        : 'transfer' in config
          ? config.transfer
          : null;
    if (!database) throw new Error('Custody storage unavailable');
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
      application_name: 'baci-primary-card-custody',
    });
    try {
      await client.connect();
      const verified = await client.query(verify, [
        'intakeOnly' in config
          ? 'primary_card_signed_intake'
          : selected.capability,
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
      const result = await client.query(selected.sql, [
        config.integrationId,
        config.environment,
        ...parameters,
      ]);
      if (result.rows.length !== 1) throw new Error('Invalid acknowledgement');
      return result.rows[0]?.result;
    } catch {
      throw new Error('Custody storage unavailable');
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}
