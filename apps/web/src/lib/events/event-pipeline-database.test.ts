import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  EventPipelineFunctionArgs,
  EventPipelineFunctionReturns,
} from './event-pipeline-database';

const cleanupArgs: EventPipelineFunctionArgs<'cleanup_domain_event_pipeline_v1'> =
  {
    p_delivered_attempt_retention: '7 days',
    p_queue_archive_retention: '7 days',
  };
const cleanupReturns: EventPipelineFunctionReturns<'cleanup_domain_event_pipeline_v1'> =
  [{ delivery_attempts_deleted: 0, queue_archive_messages_deleted: 0 }];

const modulePath = resolve(
  process.cwd(),
  'src/lib/events/event-pipeline-database.ts'
);

const functionNames = [
  'claim_event_deliveries_v1',
  'cleanup_domain_event_pipeline_v1',
  'dead_letter_ingress_event_v1',
  'enqueue_domain_event_v1',
  'finish_event_delivery_v1',
  'get_domain_event_queue_metrics_v1',
  'get_event_pipeline_operations_v1',
  'is_event_ingress_capability_v1',
  'list_event_pipeline_deliveries_v1',
  'list_event_pipeline_ingress_failures_v1',
  'read_domain_events_v1',
  'record_analytics_domain_event_v1',
  'record_event_worker_heartbeat_v1',
  'record_platform_domain_event_v1',
  'replay_event_deliveries_batch_v1',
  'replay_event_delivery_v1',
  'replay_ingress_dead_letter_v1',
  'route_domain_event_v1',
  'select_event_pipeline_replay_ids_v1',
] as const;

describe('event pipeline generated database boundary', () => {
  it('compiles cleanup worker Args and Returns beside its source proof', () => {
    const wrapper = readFileSync(
      resolve(
        process.cwd(),
        '../../vps-workers/jobs/supabase-retention-cleanup.mjs'
      ),
      'utf8'
    );
    expect(cleanupReturns).toHaveLength(1);
    expect(wrapper).toContain("rpc('cleanup_domain_event_pipeline_v1', {");
    for (const key of Object.keys(cleanupArgs)) expect(wrapper).toContain(key);
    expect(wrapper).not.toMatch(/\bas\s+(?:never|unknown|object)\b/);
  });

  it('pins explicit factory ReturnType compatibility proofs', () => {
    const proofs = [
      [
        'service.test.ts',
        [
          'Expect<Equal<ReturnType<typeof createServiceClient>, SupabaseClient>>',
        ],
      ],
      [
        'server.test.ts',
        [
          'Promise<ReturnType<typeof createClient>>',
          'Expect<Equal<ReturnType<typeof createClient>, SupabaseClient>>',
        ],
      ],
      [
        'admin.test.ts',
        [
          'Expect<Equal<ReturnType<typeof createClient>, SupabaseClient>>',
          'Expect<Equal<ReturnType<typeof createAdminClient>, SupabaseClient>>',
        ],
      ],
    ] as const;
    for (const [file, contracts] of proofs) {
      const source = readFileSync(
        resolve(process.cwd(), `src/lib/supabase/${file}`),
        'utf8'
      );
      for (const contract of contracts) expect(source).toContain(contract);
    }
  });

  it('binds all nineteen public functions to executable catalog effects', async () => {
    expect(existsSync(modulePath), 'typed database boundary is missing').toBe(
      true
    );
    if (!existsSync(modulePath)) return;

    const moduleUrl = pathToFileURL(modulePath).href;
    const boundary = await import(/* @vite-ignore */ moduleUrl);
    expect(boundary.EVENT_PIPELINE_FUNCTION_NAMES).toEqual(functionNames);

    const artifact = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'tools/db/fixtures/production-history-effects.json'
        ),
        'utf8'
      )
    ) as {
      source: { querySha256: string };
      digestVector: { category: string; identity: string; sha256: string }[];
    };
    const query = readFileSync(
      resolve(process.cwd(), 'tools/db/supabase-history-effects.sql'),
      'utf8'
    );
    expect(createHash('sha256').update(query).digest('hex')).toBe(
      artifact.source.querySha256
    );
    const functionGenerator = query.match(
      /function_components AS \([\s\S]*?\n\),\nselected_column_components/
    )?.[0];
    expect(functionGenerator).toMatch(/pg_get_function_identity_arguments/);
    expect(functionGenerator).toMatch(/pg_get_functiondef/);
    expect(functionGenerator).toMatch(/p\.proconfig/);
    expect(functionGenerator).toMatch(/p\.prosecdef/);
    expect(functionGenerator).toMatch(/function_acl_rows/);

    const expected = [
      [
        'claim_event_deliveries_v1(p_batch_size integer, p_worker_id text, p_lease_seconds integer)',
        '856093d74042cb95e5148ef543832fe59709f40751d94df9e8370e6c7a551d53',
      ],
      [
        'cleanup_domain_event_pipeline_v1(p_delivered_attempt_retention interval, p_queue_archive_retention interval)',
        '16347029ef165040d2bad390526fa49db1c0c5bcc371d2eace04d885fbdb193e',
      ],
      [
        'dead_letter_ingress_event_v1(p_queue_message_id bigint, p_domain_event_id uuid, p_original_envelope jsonb, p_failure_code text, p_failure_message text, p_parser_version integer)',
        '0eddbd15fcee2648694ec7b651c9d880830d630e525f757e8cc2279a5887e6d1',
      ],
      [
        'enqueue_domain_event_v1(p_producer text, p_trust_level text, p_idempotency_key text, p_external_event_id text, p_event_name text, p_subject_type text, p_subject_id text, p_merchant_id uuid, p_source jsonb, p_data jsonb, p_metadata jsonb, p_occurred_at timestamp with time zone, p_changed_fields text[], p_correlation_id text, p_causation_id uuid)',
        '8b30c983354635b9e2b6fbf09b168f8b16d5faad8fb3606481df10563ef0900d',
      ],
      [
        'finish_event_delivery_v1(p_delivery_id uuid, p_claim_token uuid, p_outcome text, p_available_at timestamp with time zone, p_error_code text, p_error_message text, p_http_status integer, p_provider_response_id text)',
        'cc59952fce3ff2f111b972a210134859c140f731b392519eda9f735e59792c43',
      ],
      [
        'get_domain_event_queue_metrics_v1()',
        '77d39125fd964c9d7f360562eb43c5e5c553807225fd3ef338349c5f961daf34',
      ],
      [
        'get_event_pipeline_operations_v1()',
        '24ebaeeec14fab67747f983ae5b3d6568e572140123f300afb0e57336bc39935',
      ],
      [
        'is_event_ingress_capability_v1(p_kind text, p_merchant_id uuid, p_event_type text, p_event_name text, p_event_id text, p_event_timestamp timestamp with time zone, p_producer text, p_source text, p_trust_level text)',
        '21dec94cc9b3cce94e2e58e8ac06ae5a22d6819f29f1b998bbecbe2d48d6413f',
      ],
      [
        'list_event_pipeline_deliveries_v1(p_status text, p_limit integer, p_offset integer, p_destination text, p_error_code text, p_merchant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)',
        'df7c55f9d414c1ed6ff9a65f2d764a53687d6870352893377e25050970976c0a',
      ],
      [
        'list_event_pipeline_ingress_failures_v1(p_limit integer, p_offset integer, p_error_code text, p_merchant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)',
        '9cf517a67d452eca18d62781a313ddd90abb30da7a14d1321b959fc51d9dcde5',
      ],
      [
        'read_domain_events_v1(p_visibility_timeout_seconds integer, p_batch_size integer, p_max_poll_seconds integer)',
        '6e9d80dfef812bf9b33732f95993e9e281954640e9f88503190d1a73a141783d',
      ],
      [
        'record_analytics_domain_event_v1(p_merchant_id uuid, p_event_type text, p_event_name text, p_event_data jsonb, p_domain_event_data jsonb, p_delivery_data jsonb, p_external_event_id text, p_source text, p_producer text, p_trust_level text, p_event_timestamp timestamp with time zone, p_metadata jsonb)',
        '28d53393eed4d9fc53d39daf56e2376f652107d57a2ae49e4755f25cbc711307',
      ],
      [
        'record_event_worker_heartbeat_v1(p_worker_name text, p_worker_id text, p_status text, p_processed_count integer, p_error_code text)',
        'c17630e03bc03eafaf4eaf565c76f362a48afe6a0d1f309a8035788087e84d39',
      ],
      [
        'record_platform_domain_event_v1(p_event_type text, p_event_name text, p_event_data jsonb, p_delivery_data jsonb, p_external_event_id text, p_merchant_id uuid, p_session_id text, p_page_url text, p_referrer text, p_producer text, p_trust_level text, p_event_timestamp timestamp with time zone, p_metadata jsonb)',
        '0efd889c70bbecb978386a46d357ed87e6ff79191afa9aed4acb88f8def77564',
      ],
      [
        'replay_event_deliveries_batch_v1(p_delivery_ids uuid[], p_replayed_by uuid, p_replay_reason text)',
        '9444edcfec7244ca461c6d73c1274cb905d811483c60c48c2bc48bbfb7c165ed',
      ],
      [
        'replay_event_delivery_v1(p_delivery_id uuid, p_replayed_by uuid, p_replay_reason text)',
        '765eee6a356e4b54b7ff20bb8c816cc4a2e68b2219b657da72f08075a04eb4ae',
      ],
      [
        'replay_ingress_dead_letter_v1(p_failure_id uuid, p_replayed_by uuid, p_replay_reason text)',
        '66c5e91efc4d6b8c51c0a2b04a596bb129a4d374210699740914c13ae0b9d6c4',
      ],
      [
        'route_domain_event_v1(p_queue_message_id bigint, p_domain_event_id uuid, p_destinations text[], p_shadow boolean, p_active_destinations text[])',
        '4f8741f1109c1e0fa00fbc97f5d2da838b0f96974c3748b4bd1b095e966304ae',
      ],
      [
        'select_event_pipeline_replay_ids_v1(p_status text, p_destination text, p_error_code text, p_merchant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)',
        '607f82dbc6c5cdcde5bc4fe0b5287aff8be3f9f3b087f6b7e4155f9531e7cf8e',
      ],
    ] as const;
    const actual = artifact.digestVector
      .filter(
        ({ category, identity }) =>
          category === 'function' &&
          identity.startsWith('public.') &&
          functionNames.some((name) => identity.startsWith(`public.${name}(`))
      )
      .map(({ identity, sha256 }) => [identity.slice(7), sha256]);
    expect(actual).toEqual(expected);
    expect(expected.map(([identity]) => identity.replace(/\(.*/, ''))).toEqual(
      functionNames
    );

    const regression = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/tests/restore_merchants_anon_public_columns.sql'
      ),
      'utf8'
    );
    expect(regression).toContain('DO $event_pipeline_contracts$');
  });
  // biome-ignore format: exact caller authority is intentionally compact to remain below the modularity gate.
  it('assigns worker RPCs to their leaf callers without moving bootstrap authority', async () => {
    const { EVENT_PIPELINE_BOUNDARY } = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
    expect(EVENT_PIPELINE_BOUNDARY.callers).toEqual({
      'apps/web/src/app/api/admin/event-pipeline/dead-letters/route.ts': ['get_event_pipeline_operations_admin_v3', 'list_event_pipeline_deliveries_admin_v3', 'list_event_pipeline_ingress_failures_admin_v3'],
      'apps/web/src/app/api/admin/event-pipeline/replay/route.ts': ['replay_event_deliveries_batch_v1', 'replay_ingress_dead_letter_v1', 'select_event_pipeline_replay_ids_v1'],
      'apps/web/src/app/api/cron/drain-cache-invalidations/route.ts': ['claim_cache_invalidations', 'finish_cache_invalidation', 'has_cache_invalidation_dead_letters'],
      'apps/web/src/lib/events/enqueue-paid-order-domain-event.ts': ['enqueue_domain_event_v1'],
      'apps/web/src/lib/events/record-analytics-domain-event.ts': ['record_analytics_domain_event_v1'],
      'apps/web/src/lib/events/record-platform-domain-event.ts': ['record_platform_domain_event_v1'],
      'apps/web/src/scripts/domain-event-worker-batch.ts': ['dead_letter_ingress_event_v1', 'route_domain_event_v1'],
      'apps/web/src/scripts/domain-event-worker.ts': ['read_domain_events_v1', 'record_event_worker_heartbeat_v1'],
      'apps/web/src/scripts/event-delivery-worker.ts': ['claim_event_deliveries_v1', 'record_event_worker_heartbeat_v1'],
      'apps/web/src/scripts/process-claimed-event-delivery.ts': ['finish_event_delivery_v1'],
      'vps-workers/jobs/cleanup-legacy-expense-receipts.mjs': [
        'authorize_legacy_expense_receipt_cleanup_deletion',
        'claim_legacy_expense_receipt_cleanup_candidates',
        'complete_legacy_expense_receipt_cleanup',
      ],
      'vps-workers/jobs/cleanup-private-expense-receipts.mjs': [
        'authorize_expense_private_receipt_cleanup_deletion',
        'claim_expense_private_receipt_cleanup_candidates',
        'complete_expense_private_receipt_cleanup',
      ],
      'vps-workers/jobs/supabase-retention-cleanup.mjs': ['cleanup_domain_event_pipeline_v1'],
    });
    for (const path of ['apps/web/src/scripts/process-domain-events.ts', 'apps/web/src/scripts/process-event-deliveries.ts']) {
      expect(EVENT_PIPELINE_BOUNDARY.authority.serviceImporters).toContain(path);
      expect(EVENT_PIPELINE_BOUNDARY.productionRoots).toContain(path);
    }
  });
});
