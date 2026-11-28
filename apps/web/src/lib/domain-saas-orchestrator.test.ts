import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DomainBindingRow,
  DomainLifecycleWriter,
} from './domain-lifecycle-writer';
import {
  reconcileDeletingBinding,
  reconcileProvisioningBinding,
} from './domain-saas-orchestrator';

function makeBinding(
  overrides: Partial<DomainBindingRow> = {}
): DomainBindingRow {
  return {
    id: 'binding-1',
    domain_id: 'domain-1',
    merchant_id: 'merchant-1',
    hostname: 'shop.example.com',
    dns_routing_provider: 'cloudflare_saas',
    cloudflare_zone_id: 'zone_1',
    cloudflare_hostname_id: null,
    requested_is_primary: false,
    lifecycle_state: 'provisioning',
    current_operation_id: 'op-1',
    in_flight_lease_until: '2026-11-28T13:00:00Z',
    cloudflare_create_state: 'none',
    vercel_create_state: 'none',
    next_reconcile_at: '2026-11-28T13:00:00Z',
    provider_verification_records: [],
    ...overrides,
  };
}

function makeWriter(initial: DomainBindingRow): DomainLifecycleWriter {
  let current = { ...initial };
  return {
    claimDueBindings: vi.fn(async () => [current]),
    recordProviderResult: vi.fn(async (input) => {
      current = {
        ...current,
        cloudflare_zone_id:
          input.cloudflareZoneId ?? current.cloudflare_zone_id,
        cloudflare_hostname_id:
          input.cloudflareHostnameId ?? current.cloudflare_hostname_id,
        cloudflare_create_state:
          input.provider === 'cloudflare'
            ? (input.state as DomainBindingRow['cloudflare_create_state'])
            : current.cloudflare_create_state,
        vercel_create_state:
          input.provider === 'vercel'
            ? (input.state as DomainBindingRow['vercel_create_state'])
            : current.vercel_create_state,
        provider_verification_records:
          input.verificationRecords ?? current.provider_verification_records,
      };
      if (
        current.lifecycle_state === 'provisioning' &&
        current.cloudflare_create_state === 'confirmed' &&
        current.vercel_create_state === 'confirmed'
      ) {
        current = { ...current, lifecycle_state: 'pending_verification' };
      }
      return current;
    }),
    advanceToVerifyingRouting: vi.fn(async () => current),
    commitDomainActive: vi.fn(async () => current),
    withdrawVerifyingRouting: vi.fn(async () => current),
    finalizeDomainDeletion: vi.fn(async () => {
      const cfDone =
        current.cloudflare_create_state === 'deleted' ||
        current.cloudflare_create_state === 'none';
      const vercelDone =
        current.vercel_create_state === 'deleted' ||
        current.vercel_create_state === 'none';
      return cfDone && vercelDone;
    }),
    listActiveSaasPurgeTargets: vi.fn(async () => []),
  };
}

describe('domain-saas-orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recovers an unresolved Cloudflare attempt after crash without issuing a second create', async () => {
    // Process crashed right after dispatching CF create (state = in_flight, no hostname_id)
    const initial = makeBinding({
      cloudflare_create_state: 'in_flight',
      vercel_create_state: 'none',
    });
    const writer = makeWriter(initial);

    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        // Must ONLY do GET lookup, never POST create while resuming unresolved attempt
        expect(init?.method).toBe('GET');
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: 'cf_recovered_1',
                hostname: 'shop.example.com',
                status: 'pending',
                ssl: { status: 'pending_validation', validation_records: [] },
              },
            ],
          }),
          { status: 200 }
        );
      }
    );

    const vercelClient = {
      addDomain: vi.fn(async () => ({
        name: 'shop.example.com',
        apexName: 'example.com',
        projectId: 'prj_1',
        updatedAt: 1,
        createdAt: 1,
        verified: false,
        verification: [],
      })),
      removeDomain: vi.fn(),
      verifyDomain: vi.fn(),
    };

    const res = await reconcileProvisioningBinding(initial, {
      cfConfig: { apiToken: 'tok', zoneId: 'zone_1', fetchImpl },
      writer,
      vercelClient,
    });

    expect(res.settled).toBe(true);
    expect(res.binding.cloudflare_hostname_id).toBe('cf_recovered_1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vercelClient.addDomain).toHaveBeenCalledTimes(1);
  });

  it('keeps hostname reserved when unresolved Cloudflare create has not appeared yet, then deletes on late appearance after 120s', async () => {
    // Vercel already settled as deleted; Cloudflare create timed out (indeterminate)
    const initial = makeBinding({
      lifecycle_state: 'deleting_reconciling',
      cloudflare_create_state: 'indeterminate',
      vercel_create_state: 'deleted',
    });
    const writer = makeWriter(initial);

    // Sweep 1 (t=120s): Cloudflare still returns empty list -> MUST NOT release
    const emptyFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: [] }), {
          status: 200,
        })
    );
    const sweep1 = await reconcileDeletingBinding(initial, {
      cfConfig: { apiToken: 'tok', zoneId: 'zone_1', fetchImpl: emptyFetch },
      writer,
    });
    expect(sweep1.released).toBe(false);
    expect(sweep1.binding.cloudflare_create_state).toBe('indeterminate');

    // Sweep 2 (t=150s): Late Cloudflare object appears -> deleted and hostname released
    let call = 0;
    const lateAppearFetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                id: 'cf_late_99',
                hostname: 'shop.example.com',
                status: 'pending',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ success: true, result: { id: 'cf_late_99' } }),
        { status: 200 }
      );
    });

    const sweep2 = await reconcileDeletingBinding(sweep1.binding, {
      cfConfig: {
        apiToken: 'tok',
        zoneId: 'zone_1',
        fetchImpl: lateAppearFetch,
      },
      writer,
    });
    expect(sweep2.released).toBe(true);
    expect(sweep2.binding.cloudflare_create_state).toBe('deleted');
    expect(lateAppearFetch).toHaveBeenCalledTimes(2);
  });

  it('treats 404 on a known Cloudflare hostname ID and Vercel not-found as terminal after lost delete responses', async () => {
    const initial = makeBinding({
      lifecycle_state: 'deleting_reconciling',
      cloudflare_hostname_id: 'cf_known_1',
      cloudflare_create_state: 'indeterminate',
      vercel_create_state: 'indeterminate',
    });
    const writer = makeWriter(initial);

    const cf404Fetch = vi.fn(async () => new Response('', { status: 404 }));
    const vercelClient = {
      addDomain: vi.fn(),
      verifyDomain: vi.fn(),
      removeDomain: vi.fn(async () => {
        throw new Error('Domain not found (404)');
      }),
    };

    const res = await reconcileDeletingBinding(initial, {
      cfConfig: { apiToken: 'tok', zoneId: 'zone_1', fetchImpl: cf404Fetch },
      writer,
      vercelClient,
    });
    expect(res.released).toBe(true);
    expect(res.binding.cloudflare_create_state).toBe('deleted');
    expect(res.binding.vercel_create_state).toBe('deleted');
  });
});
