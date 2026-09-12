import { eventPipelineAdminImporters } from '@/lib/events/event-pipeline-authority-paths';
import { eventPipelineAuthorityServicePaths } from '@/lib/events/event-pipeline-authority-service-paths';
import { eventPipelineCredentialPaths } from '@/lib/events/event-pipeline-credential-paths';
import {
  eventPipelineFrozenRoutes,
  frozenEventPipelineAuthoritySources,
} from '@/lib/events/event-pipeline-frozen-authority-sources';
import { eventPipelineJumiaCredentialPaths } from '@/lib/events/event-pipeline-jumia-credential-paths';
import { eventPipelineLegacySdkImporters } from '@/lib/events/event-pipeline-legacy-sdk-importers';
import { eventPipelineRepairPickupCredentialPaths } from '@/lib/events/event-pipeline-repair-pickup-credential-paths';
import { eventPipelineShippingCredentialPaths } from '@/lib/events/event-pipeline-shipping-credential-paths';
import {
  eventPipelineAdminAdjacentFunctions,
  eventPipelineExpenseCleanupAdjacentFunctions,
  eventPipelineVpsRuntimeCallers,
} from '@/lib/events/event-pipeline-vps-runtime-callers';
import type { Database, Json } from '@/types/supabase';
export function toEventPipelineJson(
  value: unknown,
  ancestors = new WeakSet<object>()
): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('event_pipeline_non_json_value');
    ancestors.add(value);
    try {
      return value.map((item) => toEventPipelineJson(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error('event_pipeline_non_json_value');
    if (ancestors.has(value)) throw new Error('event_pipeline_non_json_value');
    ancestors.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          item === undefined
            ? []
            : [[key, toEventPipelineJson(item, ancestors)]]
        )
      );
    } finally {
      ancestors.delete(value);
    }
  }
  throw new Error('event_pipeline_non_json_value');
}
export function validateEventPipelineSelection(
  path: string,
  table: string,
  selection: string,
  findings: string[],
  columnsForTable: (name: string) => ReadonlySet<string>
) {
  let depth = 0;
  let start = 0;
  const segments: string[] = [];
  for (let index = 0; index <= selection.length; index += 1) {
    const character = selection[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if ((character === ',' || character === undefined) && depth === 0) {
      segments.push(selection.slice(start, index).trim());
      start = index + 1;
    }
  }
  const allowedColumns = columnsForTable(table);
  for (const segment of segments) {
    if (segment === '*') {
      findings.push(`${path}: unauthorized ${table} wildcard projection`);
      continue;
    }
    const relation = segment.match(
      /^(?:[A-Za-z_][\w$]*:)?([A-Za-z_][\w$]*)\((.*)\)$/s
    );
    if (relation) {
      validateEventPipelineSelection(
        path,
        relation[1] ?? '',
        relation[2] ?? '',
        findings,
        columnsForTable
      );
      continue;
    }
    const name = segment.match(/^[A-Za-z_][\w$]*/)?.[0];
    if (name && !allowedColumns.has(name))
      findings.push(`${path}: unauthorized ${table} column ${name}`);
  }
}
export const EVENT_PIPELINE_FUNCTION_NAMES = [
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
] as const satisfies readonly (keyof Database['public']['Functions'])[];
const columns = (value: string) => value.split(' ');
// biome-ignore format: compact RPC ownership map preserves the 300-line verifier gate.
const runtimeCallers = {
  'apps/web/src/app/api/cron/drain-cache-invalidations/route.ts': ['claim_cache_invalidations', 'finish_cache_invalidation', 'has_cache_invalidation_dead_letters'],
  'apps/web/src/app/api/admin/event-pipeline/dead-letters/route.ts': ['get_event_pipeline_operations_admin_v3', 'list_event_pipeline_deliveries_admin_v3', 'list_event_pipeline_ingress_failures_admin_v3'],
  'apps/web/src/app/api/admin/event-pipeline/replay/route.ts': ['replay_event_deliveries_batch_v1', 'replay_ingress_dead_letter_v1', 'select_event_pipeline_replay_ids_v1'],
  'apps/web/src/lib/events/enqueue-paid-order-domain-event.ts': ['enqueue_domain_event_v1'],
  'apps/web/src/lib/events/record-analytics-domain-event.ts': ['record_analytics_domain_event_v1'],
  'apps/web/src/lib/events/record-platform-domain-event.ts': ['record_platform_domain_event_v1'],
  'apps/web/src/scripts/domain-event-worker-batch.ts': ['dead_letter_ingress_event_v1', 'route_domain_event_v1'],
  'apps/web/src/scripts/domain-event-worker.ts': ['read_domain_events_v1', 'record_event_worker_heartbeat_v1'],
  'apps/web/src/scripts/event-delivery-worker.ts': ['claim_event_deliveries_v1', 'record_event_worker_heartbeat_v1'],
  'apps/web/src/scripts/process-claimed-event-delivery.ts': ['finish_event_delivery_v1'],
  ...eventPipelineVpsRuntimeCallers,
} as const;
export const EVENT_PIPELINE_BOUNDARY = {
  allFunctions: EVENT_PIPELINE_FUNCTION_NAMES,
  adjacentFunctions: [
    'claim_cache_invalidations',
    'cleanup_database_retention',
    'finish_cache_invalidation',
    'has_cache_invalidation_dead_letters',
    ...eventPipelineAdminAdjacentFunctions,
    ...eventPipelineExpenseCleanupAdjacentFunctions,
  ],
  authority: {
    adminImporters: eventPipelineAdminImporters,
    bareClientImporters: [
      ...Object.keys(eventPipelineFrozenRoutes),
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts',
      'apps/web/src/lib/merchant-feature-gates.ts',
    ],
    credentialPaths: [
      ...eventPipelineCredentialPaths,
      ...eventPipelineJumiaCredentialPaths,
      ...eventPipelineRepairPickupCredentialPaths,
      ...eventPipelineShippingCredentialPaths,
    ],
    factoryModules: [
      'apps/web/src/lib/supabase/admin.ts',
      'apps/web/src/lib/supabase/server.ts',
      'apps/web/src/lib/supabase/service.ts',
    ],
    legacySdkImporters: eventPipelineLegacySdkImporters,
    serverImporters: [
      ...Object.keys(eventPipelineFrozenRoutes),
      'apps/web/src/app/(platform)/onboarding/actions.ts',
      'apps/web/src/app/api/admin/event-pipeline/dead-letters/route.ts',
      'apps/web/src/app/api/admin/event-pipeline/replay/route.ts',
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/app/api/orders/route.ts',
      'apps/web/src/lib/platform-admin-auth.ts',
    ],
    serviceImporters: [
      'apps/web/src/app/api/cron/drain-cache-invalidations/route.ts',
      'apps/web/src/app/api/cron/gigl-tracking-notifications/route.ts',
      'apps/web/src/app/api/cron/gigl-tracking/route.ts',
      'apps/web/src/app/api/analytics/conversion/route.ts',
      'apps/web/src/app/api/events/route.ts',
      'apps/web/src/lib/events/event-pipeline-service-role-test-client.ts',
      'apps/web/src/lib/ads/server-credential-client.ts',
      'apps/web/src/lib/ads/server-spend-client.ts',
      'apps/web/src/lib/wallet/server-funding-recovery-hmac-client.ts',
      'apps/web/src/lib/shipping/server-shipping-quote-booking-economics-client.ts',
      'apps/web/src/scripts/process-domain-events.ts',
      'apps/web/src/scripts/process-event-deliveries.ts',
    ],
    servicePaths: eventPipelineAuthorityServicePaths,
    operationalServiceImporters: [
      'apps/web/src/scripts/reconcile-paystack-unmatched-partial.ts',
    ],
  },
  callers: runtimeCallers,
  frozenAuthoritySources: frozenEventPipelineAuthoritySources,
  frozenProjectionFiles: {},
  frozenRoutes: eventPipelineFrozenRoutes,
  functions: {
    serviceRoleMetrics: ['get_domain_event_queue_metrics_v1'],
    sqlInternal: ['is_event_ingress_capability_v1', 'replay_event_delivery_v1'],
    typescriptApplication: [
      ...new Set(
        Object.entries(runtimeCallers)
          .filter(([path]) => path.endsWith('.ts'))
          .flatMap(([, names]) => names)
      ),
    ],
    vpsCleanup: ['cleanup_domain_event_pipeline_v1'],
  },
  operations: {
    analytics_events: ['insert', 'upsert'],
    domains: ['select'],
    merchant_feature_settings: ['select'],
    merchant_slug_aliases: ['select'],
    merchants: ['select'],
    order_items: ['select'],
    orders: ['select'],
    platform_events: ['insert'],
    platform_settings: ['select'],
  },
  projectionAuthorities: {
    'apps/web/src/app/api/analytics/conversion/conversion-route-merchant-context.ts':
      ['identity'],
    'apps/web/src/app/api/platform/events/platform-event-forwarding.ts': [
      'platformProviderConfig',
    ],
    'apps/web/src/lib/analytics/fetch-analytics-platform-config.ts': [
      'merchantFeatureProviderConfig',
      'merchantProviderConfig',
    ],
    'apps/web/src/lib/events/event-ingress-context.ts': ['identity'],
    'apps/web/src/lib/events/paid-order-delivery-event.ts': ['paidDelivery'],
    'apps/web/src/lib/events/platform-destination-adapter.ts': [
      'platformProviderConfig',
    ],
    'apps/web/src/lib/merchant-feature-gates.ts': [
      'identity',
      'merchantProviderConfig',
    ],
    'apps/web/src/lib/platform-admin-auth.ts': ['operatorAuth'],
  },
  projections: {
    conversion: { merchants: columns('country payout_currency') },
    identity: {
      domains: ['merchant_id'],
      merchant_slug_aliases: ['merchant_id'],
      merchants: ['id'],
    },
    legacyAnalyticsWrite: {
      analytics_events: columns(
        'merchant_id event_type event_data event_timestamp source event_id'
      ),
    },
    legacyPlatformWrite: {
      platform_events: columns(
        'event_data event_id event_timestamp event_type ip_address merchant_id page_url referrer session_id user_agent'
      ),
    },
    merchantFeatureProviderConfig: {
      merchant_feature_settings: columns(
        'facebook_pixel_id facebook_capi_token tiktok_pixel_id tiktok_access_token google_analytics_id ga4_api_secret snapchat_pixel_id snapchat_capi_token'
      ),
    },
    merchantProviderConfig: {
      merchants: columns(
        'plan_tier plan_expires_at premium_features offline_conversions_enabled facebook_pixel_id facebook_capi_token tiktok_pixel_id tiktok_access_token google_analytics_id ga4_api_secret snapchat_pixel_id snapchat_capi_token'
      ),
    },
    operatorAuth: { merchants: ['is_platform_admin'] },
    paidDelivery: {
      order_items: columns('id product_id name price quantity'),
      orders: columns(
        'id merchant_id order_number payment_status total currency customer_email customer_phone customer_name customer_id shipping_address ad_tracking'
      ),
    },
    platformProviderConfig: {
      platform_settings: columns(
        'google_analytics_id ga4_api_secret facebook_pixel_id facebook_capi_token'
      ),
    },
  },
  productionRoots: [
    ...Object.keys(runtimeCallers),
    'apps/web/src/scripts/process-domain-events.ts',
    'apps/web/src/scripts/process-event-deliveries.ts',
    'apps/web/src/lib/events/event-ingress-capability.ts',
    'apps/web/src/lib/events/event-ingress-context.ts',
    'apps/web/src/lib/events/paid-order-delivery-event.ts',
    'apps/web/src/lib/events/record-platform-order-created-event.ts',
  ],
} as const;
// biome-ignore format: compact type contracts preserve the 300-line verifier gate.
export type EventPipelineFunctionArgs<Name extends (typeof EVENT_PIPELINE_FUNCTION_NAMES)[number]> = Database['public']['Functions'][Name]['Args'];
// biome-ignore format: compact type contracts preserve the 300-line verifier gate.
export type EventPipelineFunctionReturns<Name extends (typeof EVENT_PIPELINE_FUNCTION_NAMES)[number]> = Database['public']['Functions'][Name]['Returns'];
// biome-ignore format: compact worker type contract preserves the 300-line verifier gate.
export type EventPipelineWorkerContracts = {
  cleanup: { args: EventPipelineFunctionArgs<'cleanup_domain_event_pipeline_v1'>; returns: EventPipelineFunctionReturns<'cleanup_domain_event_pipeline_v1'> };
  deliveryClaim: EventPipelineFunctionReturns<'claim_event_deliveries_v1'>;
  routingRead: EventPipelineFunctionArgs<'read_domain_events_v1'>;
};
