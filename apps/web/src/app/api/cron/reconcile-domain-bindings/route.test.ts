import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainBindingRow } from '@/lib/domain-lifecycle-writer';

const mockHasValidCronSecret = vi.fn();
const mockReadCloudflareSaasConfig = vi.fn();
const mockCreateDomainLifecycleWriter = vi.fn();
const mockReconcileProvisioningBinding = vi.fn();
const mockReconcileDeletingBinding = vi.fn();
const mockTriggerDomainEdgeConfigSync = vi.fn();

vi.mock('@/lib/cron-secret-auth', () => ({
  hasValidCronSecret: (...args: unknown[]) => mockHasValidCronSecret(...args),
}));

vi.mock('@/lib/cloudflare-saas', () => ({
  readCloudflareSaasConfig: () => mockReadCloudflareSaasConfig(),
}));

vi.mock('@/lib/domain-lifecycle-writer', () => ({
  createDomainLifecycleWriter: () => mockCreateDomainLifecycleWriter(),
}));

vi.mock('@/lib/domain-saas-orchestrator', () => ({
  reconcileProvisioningBinding: (...args: unknown[]) =>
    mockReconcileProvisioningBinding(...args),
  reconcileDeletingBinding: (...args: unknown[]) =>
    mockReconcileDeletingBinding(...args),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: () => mockTriggerDomainEdgeConfigSync(),
}));

import { GET } from './route';

function makeBinding(
  overrides: Partial<DomainBindingRow> = {}
): DomainBindingRow {
  return {
    id: 'b-1',
    domain_id: 'd-1',
    merchant_id: 'm-1',
    hostname: 'pilot.example.com',
    dns_routing_provider: 'cloudflare_saas',
    cloudflare_zone_id: 'zone_1',
    cloudflare_hostname_id: null,
    requested_is_primary: false,
    lifecycle_state: 'provisioning',
    current_operation_id: 'op-1',
    in_flight_lease_until: '2026-11-28T13:00:30Z',
    cloudflare_create_state: 'in_flight',
    vercel_create_state: 'none',
    next_reconcile_at: '2026-11-28T13:00:30Z',
    provider_verification_records: [],
    ...overrides,
  };
}

describe('GET /api/cron/reconcile-domain-bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasValidCronSecret.mockReturnValue(true);
    mockReadCloudflareSaasConfig.mockReturnValue({
      apiToken: 'cf-token',
      zoneId: 'zone_1',
    });
    mockTriggerDomainEdgeConfigSync.mockResolvedValue(undefined);
  });

  it('rejects requests without a valid CRON_SECRET', async () => {
    mockHasValidCronSecret.mockReturnValue(false);
    const res = await GET(
      new Request('https://usebaci.com/api/cron/reconcile-domain-bindings')
    );
    expect(res.status).toBe(401);
  });

  it('recovers a hard-crashed provisioning attempt with zero client retry and gives Worker B zero rows after Worker A commits its claim', async () => {
    const crashedBinding = makeBinding({
      lifecycle_state: 'provisioning',
      cloudflare_create_state: 'in_flight',
    });

    // Simulate claim_due_domain_bindings post-commit exclusivity:
    // Worker A claims the row; Worker B starting right after Worker A's claim commits receives [].
    const claimDueBindings = vi
      .fn()
      .mockResolvedValueOnce([crashedBinding])
      .mockResolvedValueOnce([]);

    mockCreateDomainLifecycleWriter.mockReturnValue({ claimDueBindings });
    mockReconcileProvisioningBinding.mockResolvedValue({
      binding: {
        ...crashedBinding,
        lifecycle_state: 'pending_verification',
        cloudflare_create_state: 'confirmed',
        vercel_create_state: 'confirmed',
      },
      settled: true,
      verificationRecords: [],
    });

    const req = () =>
      new Request('https://usebaci.com/api/cron/reconcile-domain-bindings', {
        headers: { authorization: 'Bearer test-cron' },
      });

    const [resA, resB] = await Promise.all([GET(req()), GET(req())]);
    const bodyA = await resA.json();
    const bodyB = await resB.json();

    expect(resA.status).toBe(200);
    expect(bodyA).toEqual({
      claimed: 1,
      reconciled: 1,
      released: 0,
      failed: 0,
    });
    expect(resB.status).toBe(200);
    expect(bodyB).toEqual({
      claimed: 0,
      reconciled: 0,
      released: 0,
      failed: 0,
    });
    expect(mockReconcileProvisioningBinding).toHaveBeenCalledTimes(1);
  });

  it('recovers an interrupted deleting binding after one provider succeeded without a second merchant DELETE', async () => {
    const interruptedDelete = makeBinding({
      lifecycle_state: 'deleting',
      cloudflare_create_state: 'deleted',
      vercel_create_state: 'confirmed',
    });

    mockCreateDomainLifecycleWriter.mockReturnValue({
      claimDueBindings: vi.fn().mockResolvedValue([interruptedDelete]),
    });
    mockReconcileDeletingBinding.mockResolvedValue({
      released: true,
      binding: { ...interruptedDelete, vercel_create_state: 'deleted' },
    });

    const res = await GET(
      new Request('https://usebaci.com/api/cron/reconcile-domain-bindings', {
        headers: { authorization: 'Bearer test-cron' },
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      claimed: 1,
      reconciled: 1,
      released: 1,
      failed: 0,
    });
    expect(mockReconcileDeletingBinding).toHaveBeenCalledTimes(1);
    expect(mockTriggerDomainEdgeConfigSync).toHaveBeenCalledTimes(1);
  });
});
