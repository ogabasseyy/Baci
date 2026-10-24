import type { DomainEventV1 } from '@baci/shared/contracts';
import type { EventRouteDestination } from './event-route-destination';

type EventTrustLevel = DomainEventV1['trust_level'];
type EventProducer = DomainEventV1['producer'];
type RouteDefinition = {
  allowedProducers: readonly EventProducer[];
  allowedTrust: readonly EventTrustLevel[];
  destinations: readonly EventRouteDestination[];
};

const VERIFIED_CLIENT_TRUST: readonly EventTrustLevel[] = [
  'authenticated_client',
  'tenant_verified_client',
];
const PUBLIC_CLIENT_TRUST: readonly EventTrustLevel[] = [
  'anonymous_client',
  ...VERIFIED_CLIENT_TRUST,
];
const SERVER_TRUST: readonly EventTrustLevel[] = ['server', 'database'];
const CLIENT_PRODUCERS: readonly EventProducer[] = ['web', 'mobile'];
const SERVER_PRODUCERS: readonly EventProducer[] = ['worker', 'database'];
const SERVER_ROUTE = {
  allowedProducers: SERVER_PRODUCERS,
  allowedTrust: SERVER_TRUST,
} as const;
const CLIENT_VERIFIED_ROUTE = {
  allowedProducers: CLIENT_PRODUCERS,
  allowedTrust: VERIFIED_CLIENT_TRUST,
} as const;
const CLIENT_PUBLIC_ROUTE = {
  allowedProducers: CLIENT_PRODUCERS,
  allowedTrust: PUBLIC_CLIENT_TRUST,
} as const;

const EVENT_ROUTES: Record<string, RouteDefinition> = {
  'analytics.add_payment_info.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.add_to_cart.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.add_to_wishlist.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.begin_checkout.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.customer_registered.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.place_order.v1': {
    ...SERVER_ROUTE,
    destinations: ['tiktok'],
  },
  'analytics.product_view.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'analytics.purchase.completed.v1': {
    ...SERVER_ROUTE,
    destinations: ['facebook', 'tiktok', 'ga4', 'snapchat', 'chatgpt'],
  },
  'analytics.search.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['facebook', 'tiktok', 'snapchat'],
  },
  'platform.landing_page_view.v1': {
    ...CLIENT_PUBLIC_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.merchant_first_sale.v1': {
    ...SERVER_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.merchant_signup_completed.v1': {
    ...SERVER_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.merchant_signup_started.v1': {
    ...CLIENT_PUBLIC_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.merchant_store_published.v1': {
    ...SERVER_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.platform_checkout.v1': {
    ...CLIENT_VERIFIED_ROUTE,
    destinations: ['ga4'],
  },
  'platform.platform_purchase.v1': {
    ...SERVER_ROUTE,
    destinations: ['facebook', 'ga4'],
  },
  'platform.pricing_page_view.v1': {
    ...CLIENT_PUBLIC_ROUTE,
    destinations: ['ga4'],
  },
};

const CLIENT_OBSERVATION_ONLY_EVENTS = new Set([
  'analytics.client.observed.v1',
  'analytics.page_view.v1',
  'analytics.purchase.observed.v1',
  'analytics.remove_from_cart.v1',
  'analytics.share.v1',
  'platform.client.observed.v1',
]);
const DATABASE_OBSERVATION_ONLY_EVENTS = new Set([
  'catalog.product.created.v1',
  'catalog.product.deleted.v1',
  'catalog.product.updated.v1',
  'commerce.order.cancelled.v1',
  'commerce.order.paid.v1',
  'commerce.order.status_changed.v1',
  'payments.transaction.status_changed.v1',
]);

export type EventRouteResolution =
  | { kind: 'dead_letter'; code: string }
  | { kind: 'no_route'; destinations: [] }
  | { kind: 'route'; destinations: EventRouteDestination[] };

export function resolveEventRoute(event: DomainEventV1): EventRouteResolution {
  if (CLIENT_OBSERVATION_ONLY_EVENTS.has(event.event_name)) {
    if (
      !CLIENT_PRODUCERS.includes(event.producer) ||
      !PUBLIC_CLIENT_TRUST.includes(event.trust_level)
    ) {
      return {
        code: 'producer_not_authorized_for_event',
        kind: 'dead_letter',
      };
    }
    return { destinations: [], kind: 'no_route' };
  }
  if (DATABASE_OBSERVATION_ONLY_EVENTS.has(event.event_name)) {
    if (event.producer !== 'database' || event.trust_level !== 'database') {
      return {
        code: 'producer_not_authorized_for_event',
        kind: 'dead_letter',
      };
    }
    return { destinations: [], kind: 'no_route' };
  }

  const definition = Object.hasOwn(EVENT_ROUTES, event.event_name)
    ? EVENT_ROUTES[event.event_name]
    : undefined;
  if (!definition) return { code: 'unknown_event_name', kind: 'dead_letter' };
  const hasMismatchedDatabaseAuthority =
    (event.producer === 'database') !== (event.trust_level === 'database');
  if (
    !definition.allowedProducers.includes(event.producer) ||
    !definition.allowedTrust.includes(event.trust_level) ||
    hasMismatchedDatabaseAuthority
  ) {
    return {
      code: 'producer_not_authorized_for_event',
      kind: 'dead_letter',
    };
  }
  const eventData =
    event.data.event_data && typeof event.data.event_data === 'object'
      ? (event.data.event_data as Record<string, unknown>)
      : undefined;
  const rawTargets = eventData?.targets;
  const requestedTargets = Array.isArray(rawTargets)
    ? rawTargets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => (target === 'google' ? 'ga4' : target))
    : undefined;
  const destinations = requestedTargets
    ? definition.destinations.filter((destination) =>
        requestedTargets.includes(destination)
      )
    : [...definition.destinations];
  return destinations.length > 0
    ? { destinations, kind: 'route' }
    : { destinations: [], kind: 'no_route' };
}
