import 'server-only';
import { Client } from 'pg';
import type {
  DomainLifecycleState,
  DomainVerificationRecord,
  ProviderCreateState,
} from '@/schemas/cloudflare-saas';
import {
  type DomainLifecycleWriterRuntime,
  readDomainLifecycleWriterRuntime,
} from '@/schemas/domain-lifecycle-writer-runtime';

const VERIFY_SESSION_SQL = `SELECT current_database() AS database_name,
  SESSION_USER AS login_name, CURRENT_USER AS role_name,
  (NOT role.rolsuper AND NOT role.rolbypassrls AND NOT role.rolcreaterole
    AND NOT role.rolcreatedb AND NOT role.rolreplication
    AND pg_catalog.pg_has_role(SESSION_USER, 'baci_domain_lifecycle_writer', 'MEMBER')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
      WHERE membership.member = role.oid AND parent.rolname <> 'baci_domain_lifecycle_writer')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domain_provider_bindings', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domain_provider_bindings', 'INSERT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domain_provider_bindings', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domain_provider_bindings', 'DELETE')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domains', 'SELECT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domains', 'INSERT')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domains', 'UPDATE')
    AND NOT pg_catalog.has_table_privilege(SESSION_USER, 'public.domains', 'DELETE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.claim_due_domain_bindings(integer,integer)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.record_domain_provider_result(uuid,uuid,text,text,text,text,jsonb,integer)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.advance_domain_to_verifying_routing(uuid,uuid)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.commit_domain_active(uuid,uuid)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.withdraw_domain_verifying_routing(uuid,uuid)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.finalize_domain_deletion(uuid,uuid,boolean)', 'EXECUTE')
    AND pg_catalog.has_function_privilege(SESSION_USER, 'domain_lifecycle_private.list_active_saas_purge_targets(uuid)', 'EXECUTE')) AS safe,
  EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid() AND ssl) AS tls
  FROM pg_catalog.pg_roles role WHERE role.rolname = SESSION_USER`;

export interface DomainBindingRow {
  id: string;
  domain_id: string;
  merchant_id: string;
  hostname: string;
  dns_routing_provider: 'cloudflare_saas' | 'vercel';
  cloudflare_zone_id: string | null;
  cloudflare_hostname_id: string | null;
  requested_is_primary: boolean;
  lifecycle_state: DomainLifecycleState;
  current_operation_id: string | null;
  in_flight_lease_until: string | null;
  cloudflare_create_state: ProviderCreateState;
  vercel_create_state: ProviderCreateState;
  next_reconcile_at: string | null;
  provider_verification_records: DomainVerificationRecord[];
}

export interface RecordProviderResultInput {
  domainId: string;
  operationId: string;
  provider: 'cloudflare' | 'vercel';
  state: 'in_flight' | 'indeterminate' | 'confirmed' | 'deleted' | 'failed';
  cloudflareZoneId?: string | null;
  cloudflareHostnameId?: string | null;
  verificationRecords?: DomainVerificationRecord[] | null;
  nextReconcileSeconds?: number | null;
}

export interface DomainLifecycleWriter {
  claimDueBindings(
    limit?: number,
    leaseSeconds?: number
  ): Promise<DomainBindingRow[]>;
  recordProviderResult(
    input: RecordProviderResultInput
  ): Promise<DomainBindingRow>;
  advanceToVerifyingRouting(
    domainId: string,
    operationId: string
  ): Promise<DomainBindingRow>;
  commitDomainActive(
    domainId: string,
    operationId: string
  ): Promise<DomainBindingRow>;
  withdrawVerifyingRouting(
    domainId: string,
    operationId: string
  ): Promise<DomainBindingRow>;
  finalizeDomainDeletion(
    domainId: string,
    operationId: string,
    operatorReconciled?: boolean
  ): Promise<boolean>;
  listActiveSaasPurgeTargets(
    merchantId: string
  ): Promise<Array<{ hostname: string; cloudflare_zone_id: string | null }>>;
}

export class DomainLifecycleWriterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainLifecycleWriterError';
    this.code = code;
  }
}

async function withVerifiedClient<T>(
  config: DomainLifecycleWriterRuntime,
  fn: (client: Client) => Promise<T>
): Promise<T> {
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
    query_timeout: 5000,
    statement_timeout: 4000,
    lock_timeout: 2000,
    options: '-c search_path=pg_catalog',
    application_name: 'baci-domain-lifecycle-writer',
  });

  try {
    await client.connect();
    const check = await client.query<{
      database_name: string;
      login_name: string;
      role_name: string;
      safe: boolean;
      tls: boolean;
    }>(VERIFY_SESSION_SQL);
    const session = check.rows[0];
    if (
      check.rows.length !== 1 ||
      !session ||
      session.database_name !== config.database.name ||
      session.login_name !== config.database.login ||
      session.role_name !== config.database.login ||
      session.safe !== true ||
      session.tls !== true
    ) {
      throw new DomainLifecycleWriterError(
        'INVALID_WRITER_SESSION',
        'Domain lifecycle writer session failed least-privilege or TLS verification'
      );
    }

    return await fn(client);
  } catch (error) {
    if (error instanceof DomainLifecycleWriterError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : 'Domain lifecycle writer failed';
    if (message.includes('stale_or_invalid_operation_id')) {
      throw new DomainLifecycleWriterError(
        'STALE_OPERATION_ID',
        'Domain operation lease is stale or invalid'
      );
    }
    if (message.includes('domain_not_ready_for_routing_verification')) {
      throw new DomainLifecycleWriterError(
        'NOT_READY_FOR_ROUTING',
        'Domain is not ready for routing verification'
      );
    }
    if (message.includes('domain_not_in_verifying_routing')) {
      throw new DomainLifecycleWriterError(
        'NOT_IN_VERIFYING_ROUTING',
        'Domain is not currently in verifying_routing state'
      );
    }
    throw new DomainLifecycleWriterError(
      'WRITER_UNAVAILABLE',
      'Domain lifecycle writer is unavailable'
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

export function createDomainLifecycleWriter(
  runtimeOverride?: DomainLifecycleWriterRuntime | null
): DomainLifecycleWriter | null {
  const config =
    runtimeOverride === undefined
      ? readDomainLifecycleWriterRuntime()
      : runtimeOverride;
  if (!config) return null;

  return {
    claimDueBindings(limit = 10, leaseSeconds = 30) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<DomainBindingRow>(
          'SELECT * FROM domain_lifecycle_private.claim_due_domain_bindings($1::int, $2::int)',
          [limit, leaseSeconds]
        );
        return res.rows;
      });
    },

    recordProviderResult(input) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<DomainBindingRow>(
          'SELECT * FROM domain_lifecycle_private.record_domain_provider_result($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::int)',
          [
            input.domainId,
            input.operationId,
            input.provider,
            input.state,
            input.cloudflareZoneId ?? null,
            input.cloudflareHostnameId ?? null,
            input.verificationRecords
              ? JSON.stringify(input.verificationRecords)
              : null,
            input.nextReconcileSeconds ?? null,
          ]
        );
        const row = res.rows[0];
        if (!row) {
          throw new DomainLifecycleWriterError(
            'WRITER_UNAVAILABLE',
            'record_domain_provider_result returned no row'
          );
        }
        return row;
      });
    },

    advanceToVerifyingRouting(domainId, operationId) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<DomainBindingRow>(
          'SELECT * FROM domain_lifecycle_private.advance_domain_to_verifying_routing($1::uuid, $2::uuid)',
          [domainId, operationId]
        );
        const row = res.rows[0];
        if (!row) {
          throw new DomainLifecycleWriterError(
            'WRITER_UNAVAILABLE',
            'advance_domain_to_verifying_routing returned no row'
          );
        }
        return row;
      });
    },

    commitDomainActive(domainId, operationId) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<DomainBindingRow>(
          'SELECT * FROM domain_lifecycle_private.commit_domain_active($1::uuid, $2::uuid)',
          [domainId, operationId]
        );
        const row = res.rows[0];
        if (!row) {
          throw new DomainLifecycleWriterError(
            'WRITER_UNAVAILABLE',
            'commit_domain_active returned no row'
          );
        }
        return row;
      });
    },

    withdrawVerifyingRouting(domainId, operationId) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<DomainBindingRow>(
          'SELECT * FROM domain_lifecycle_private.withdraw_domain_verifying_routing($1::uuid, $2::uuid)',
          [domainId, operationId]
        );
        const row = res.rows[0];
        if (!row) {
          throw new DomainLifecycleWriterError(
            'WRITER_UNAVAILABLE',
            'withdraw_domain_verifying_routing returned no row'
          );
        }
        return row;
      });
    },

    finalizeDomainDeletion(domainId, operationId, operatorReconciled = false) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<{ released: boolean }>(
          'SELECT domain_lifecycle_private.finalize_domain_deletion($1::uuid, $2::uuid, $3::boolean) AS released',
          [domainId, operationId, operatorReconciled]
        );
        return res.rows[0]?.released === true;
      });
    },

    listActiveSaasPurgeTargets(merchantId) {
      return withVerifiedClient(config, async (client) => {
        const res = await client.query<{
          hostname: string;
          cloudflare_zone_id: string | null;
        }>(
          'SELECT hostname, cloudflare_zone_id FROM domain_lifecycle_private.list_active_saas_purge_targets($1::uuid)',
          [merchantId]
        );
        return res.rows;
      });
    },
  };
}
