import type { DomainEventV1 } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { resolveEventRoute } from './event-route-resolution';

function event(overrides: Partial<DomainEventV1> = {}): DomainEventV1 {
  return {
    data: {},
    domain_event_id: '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a234',
    event_name: 'analytics.begin_checkout.v1',
    idempotency_key: 'event-1',
    metadata: { environment: 'test' },
    occurred_at: '2026-07-12T12:00:00.000Z',
    producer: 'web',
    schema_version: 1,
    source: {},
    subject: { id: 'subject-1', type: 'analytics_event' },
    trust_level: 'tenant_verified_client',
    ...overrides,
  };
}

describe('resolveEventRoute', () => {
  it('routes client checkout events independently', () => {
    expect(resolveEventRoute(event())).toEqual({
      destinations: ['facebook', 'tiktok', 'snapchat'],
      kind: 'route',
    });
  });

  it('honours explicit delivery targets in durable event data', () => {
    expect(
      resolveEventRoute(
        event({ data: { event_data: { targets: ['facebook', 'google'] } } })
      )
    ).toEqual({ destinations: ['facebook'], kind: 'route' });
  });

  it('rejects anonymous purchase claims', () => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'analytics.purchase.completed.v1',
          trust_level: 'anonymous_client',
        })
      )
    ).toEqual({
      code: 'producer_not_authorized_for_event',
      kind: 'dead_letter',
    });
  });

  it('routes trusted paid-order events to all purchase destinations', () => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'analytics.purchase.completed.v1',
          producer: 'worker',
          trust_level: 'server',
        })
      )
    ).toEqual({
      destinations: ['facebook', 'tiktok', 'ga4', 'snapchat', 'chatgpt'],
      kind: 'route',
    });
  });

  it('rejects unauthorized producer and trust combinations', () => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'analytics.purchase.completed.v1',
          producer: 'web',
          trust_level: 'server',
        })
      )
    ).toEqual({
      code: 'producer_not_authorized_for_event',
      kind: 'dead_letter',
    });
  });

  it.each([
    { producer: 'database' as const, trust_level: 'server' as const },
    { producer: 'worker' as const, trust_level: 'database' as const },
  ])('rejects mismatched server producer and trust authority: $producer/$trust_level', ({
    producer,
    trust_level,
  }) => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'analytics.purchase.completed.v1',
          producer,
          trust_level,
        })
      )
    ).toEqual({
      code: 'producer_not_authorized_for_event',
      kind: 'dead_letter',
    });
  });

  it('rejects spoofed CDC names from non-database producers', () => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'commerce.order.paid.v1',
          producer: 'web',
          trust_level: 'tenant_verified_client',
        })
      )
    ).toEqual({
      code: 'producer_not_authorized_for_event',
      kind: 'dead_letter',
    });
  });

  it('archives approved CDC events without a destination', () => {
    expect(
      resolveEventRoute(
        event({
          event_name: 'catalog.product.updated.v1',
          producer: 'database',
          trust_level: 'database',
        })
      )
    ).toEqual({ destinations: [], kind: 'no_route' });
  });

  it('dead-letters unknown names', () => {
    expect(
      resolveEventRoute(event({ event_name: 'unknown.event.created.v1' }))
    ).toEqual({ code: 'unknown_event_name', kind: 'dead_letter' });
  });

  it('dead-letters inherited object keys instead of reading their values', () => {
    expect(resolveEventRoute(event({ event_name: 'constructor' }))).toEqual({
      code: 'unknown_event_name',
      kind: 'dead_letter',
    });
  });
});
