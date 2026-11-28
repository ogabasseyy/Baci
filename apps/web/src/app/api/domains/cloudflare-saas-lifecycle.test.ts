import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrfProtection = vi.fn();
const mockAuthenticateApiRequest = vi.fn();
const mockGetMerchantIdForApiUser = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetMerchantFeatureAccess = vi.fn();
const mockRequireMerchantFeatureAccess = vi.fn();
const mockReadCloudflareSaasConfig = vi.fn();
const mockCreateDomainLifecycleWriter = vi.fn();
const mockReconcileProvisioningBinding = vi.fn();
const mockReconcileDeletingBinding = vi.fn();
const mockFindCloudflareCustomHostnameByName = vi.fn();
const mockGetCloudflareCustomHostname = vi.fn();
const mockVercelRemoveDomain = vi.fn();

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => void) => fn()),
  };
});

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getMerchantIdForApiUser: (...args: unknown[]) =>
    mockGetMerchantIdForApiUser(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: (...args: unknown[]) =>
    mockGetMerchantFeatureAccess(...args),
  merchantFeatureUpgradeResponse: vi.fn(),
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/cloudflare-saas', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cloudflare-saas')>(
    '@/lib/cloudflare-saas'
  );
  return {
    ...actual,
    readCloudflareSaasConfig: () => mockReadCloudflareSaasConfig(),
    findCloudflareCustomHostnameByName: (...args: unknown[]) =>
      mockFindCloudflareCustomHostnameByName(...args),
    getCloudflareCustomHostname: (...args: unknown[]) =>
      mockGetCloudflareCustomHostname(...args),
  };
});

vi.mock('@/lib/domain-lifecycle-writer', () => ({
  createDomainLifecycleWriter: () => mockCreateDomainLifecycleWriter(),
}));

vi.mock('@/lib/domain-saas-orchestrator', () => ({
  reconcileProvisioningBinding: (...args: unknown[]) =>
    mockReconcileProvisioningBinding(...args),
  reconcileDeletingBinding: (...args: unknown[]) =>
    mockReconcileDeletingBinding(...args),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: vi.fn(),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/go54', () => ({
  getDomainInformation: vi.fn(),
  getDomainLock: vi.fn(),
  getDomainNameservers: vi.fn(),
  updateDomainLock: vi.fn(),
  updateDomainNameservers: vi.fn(),
}));

vi.mock('@/lib/vercel', () => ({
  vercel: {
    addDomain: vi.fn(),
    removeDomain: (...args: unknown[]) => mockVercelRemoveDomain(...args),
    verifyDomain: vi.fn(),
  },
}));

import { DELETE as deleteDomain } from './[domain]/route';
import { GET as getVerification } from './[domain]/verification/route';
import { POST as postDomain } from './route';

describe('Cloudflare for SaaS domain API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockGetMerchantIdForApiUser.mockResolvedValue('merchant-1');
    mockGetUserAccess.mockResolvedValue({ merchantId: 'merchant-1' });
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantFeatureAccess.mockResolvedValue({ allowed: true });
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
    mockReadCloudflareSaasConfig.mockReturnValue({
      apiToken: 'cf-token',
      zoneId: 'zone_saas',
    });
    mockCreateDomainLifecycleWriter.mockReturnValue({
      claimDueBindings: vi.fn(),
      recordProviderResult: vi.fn(),
      advanceToVerifyingRouting: vi.fn(),
      commitDomainActive: vi.fn(),
      withdrawVerifyingRouting: vi.fn(),
      finalizeDomainDeletion: vi.fn(),
    });
  });

  it('POST /api/domains returns 202 when same merchant retries during active in-flight lease', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          status: 'in_flight',
          domain_id: 'dom-1',
          binding_id: 'bind-1',
          operation_id: 'op-1',
          lifecycle_state: 'provisioning',
          verification_records: [],
        },
        error: null,
      }),
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'dom-1', domain: 'shop.example.com', status: 'pending' },
          error: null,
        }),
      })),
    };
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase,
      error: null,
    });

    const req = new NextRequest('https://usebaci.com/api/domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'shop.example.com', isPrimary: true }),
    });
    const res = await postDomain(req);
    expect(res.status).toBe(202);
    expect(mockReconcileProvisioningBinding).not.toHaveBeenCalled();
  });

  it('POST /api/domains returns 409 when another merchant already reserved the hostname', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'domain_already_registered' },
      }),
    };
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u2' },
      supabase,
      error: null,
    });

    const req = new NextRequest('https://usebaci.com/api/domains', {
      method: 'POST',
      body: JSON.stringify({ domain: 'shop.example.com', isPrimary: false }),
    });
    const res = await postDomain(req);
    expect(res.status).toBe(409);
  });

  it('DELETE /api/domains/[domain] returns 404 with zero provider calls when domain is not owned', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase,
      error: null,
    });

    const req = new NextRequest(
      'https://usebaci.com/api/domains/not-owned.example.com',
      { method: 'DELETE' }
    );
    const res = await deleteDomain(req, {
      params: Promise.resolve({ domain: 'not-owned.example.com' }),
    });
    expect(res.status).toBe(404);
    expect(mockVercelRemoveDomain).not.toHaveBeenCalled();
    expect(mockReconcileDeletingBinding).not.toHaveBeenCalled();
  });

  it('DELETE /api/domains/[domain] preserves legacy Vercel cleanup when no SaaS binding exists', async () => {
    const deleteChain = {
      eq: vi.fn().mockReturnThis(),
    };
    deleteChain.eq
      .mockReturnValueOnce(deleteChain)
      .mockResolvedValueOnce({ error: null });

    let fromCalls = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        fromCalls += 1;
        if (table === 'domains' && fromCalls === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'dom-legacy', domain: 'legacy.example.com' },
              error: null,
            }),
          };
        }
        if (table === 'domain_provider_bindings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }
        return { delete: vi.fn(() => deleteChain) };
      }),
    };
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase,
      error: null,
    });

    const req = new NextRequest(
      'https://usebaci.com/api/domains/legacy.example.com',
      { method: 'DELETE' }
    );
    const res = await deleteDomain(req, {
      params: Promise.resolve({ domain: 'legacy.example.com' }),
    });
    expect(res.status).toBe(200);
    expect(mockVercelRemoveDomain).toHaveBeenCalledWith('legacy.example.com');
    expect(mockReconcileDeletingBinding).not.toHaveBeenCalled();
  });

  it('GET /api/domains/[domain]/verification refreshes async Cloudflare TXT DCV records without creating a reservation', async () => {
    const supabase = {
      rpc: vi.fn(),
      from: vi.fn((table: string) => {
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'dom-1',
                domain: 'shop.example.com',
                status: 'pending',
                verification_token: 'tok',
              },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              hostname: 'shop.example.com',
              cloudflare_zone_id: 'zone_saas',
              cloudflare_hostname_id: 'cf_123',
              lifecycle_state: 'pending_verification',
              provider_verification_records: [],
            },
            error: null,
          }),
        };
      }),
    };
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'u1' },
      supabase,
      error: null,
    });
    mockGetCloudflareCustomHostname.mockResolvedValue({
      id: 'cf_123',
      hostname: 'shop.example.com',
      status: 'pending',
      ownership_verification: {
        type: 'txt',
        name: '_cf-custom-hostname.shop.example.com',
        value: 'own-val',
      },
      ssl: {
        status: 'pending_validation',
        validation_records: [
          {
            txt_name: '_acme-challenge.shop.example.com',
            txt_value: 'dcv-val',
          },
        ],
      },
    });

    const req = new NextRequest(
      'https://usebaci.com/api/domains/shop.example.com/verification'
    );
    const res = await getVerification(req, {
      params: Promise.resolve({ domain: 'shop.example.com' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lifecycleState).toBe('pending_verification');
    expect(body.verificationRecords).toHaveLength(3);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
