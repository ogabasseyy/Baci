import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn((callback: () => Promise<void>) => {
    void callback();
  }),
  createPublicClient: vi.fn(),
  loggerError: vi.fn(),
  recordHealthTelemetry: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.loggerError },
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: mocks.createPublicClient,
}));

vi.mock('@/lib/posthog/merchant-signup-health-telemetry', () => ({
  recordMerchantSignupHealthTelemetry: mocks.recordHealthTelemetry,
}));

import { GET } from './route';

const healthyResult = {
  alias_row_level_security_enabled: true,
  alias_select_policy_is_expected: true,
  anon_can_read_alias_merchant_id: true,
  anon_can_read_alias_old_slug: true,
  anon_can_read_merchant_id: true,
  anon_can_read_merchant_slug: true,
  anon_can_use_public_schema: true,
  anon_has_no_alias_table_select: true,
  anon_has_no_merchant_table_select: true,
  anon_select_policy_is_expected: true,
  auth_can_execute_reserved_slug_check: true,
  auth_can_execute_slug_generator: true,
  auth_can_execute_mobile_provisioning_rpc: true,
  auth_can_insert: true,
  auth_can_read_alias_merchant_id: true,
  auth_can_read_alias_old_slug: true,
  auth_can_use_public_schema: true,
  auth_can_update: true,
  auth_has_no_alias_table_select: true,
  auth_has_no_table_select: true,
  can_read_business_name: true,
  can_read_id: true,
  can_read_slug: true,
  can_read_user_id: true,
  insert_policy_allows_owner: true,
  no_restrictive_alias_select_policies: true,
  no_restrictive_anon_merchant_select_policies: true,
  no_restrictive_signup_policies: true,
  no_unexpected_permissive_anon_merchant_select_policies: true,
  no_unexpected_permissive_signup_policies: true,
  row_level_security_enabled: true,
  select_policy_is_expected: true,
  update_policy_allows_owner_or_staff: true,
  mobile_provisioning_rpc_is_invoker: true,
  anon_cannot_execute_mobile_provisioning_rpc: true,
  public_cannot_execute_mobile_provisioning_rpc: true,
  domain_insert_policy_is_expected: true,
  staff_insert_policy_is_expected: true,
  staff_update_policy_is_expected: true,
};

const mobileV2Invariants = [
  'auth_can_execute_mobile_provisioning_rpc',
  'mobile_provisioning_rpc_is_invoker',
  'anon_cannot_execute_mobile_provisioning_rpc',
  'public_cannot_execute_mobile_provisioning_rpc',
  'domain_insert_policy_is_expected',
  'staff_insert_policy_is_expected',
  'staff_update_policy_is_expected',
] as const;

function cronRequest(authHeader: string | null = 'Bearer cron-secret') {
  return new NextRequest(
    'http://localhost:3000/api/cron/merchant-signup-health',
    { headers: authHeader ? { authorization: authHeader } : {} }
  );
}

describe('GET /api/cron/merchant-signup-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.createPublicClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: healthyResult, error: null });
    mocks.recordHealthTelemetry.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 without calling the RPC when the cron secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 without calling the RPC when authorization is invalid', async () => {
    const response = await GET(cronRequest('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns 401 without calling the RPC when authorization is absent', async () => {
    const response = await GET(cronRequest(null));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns healthy when every policy invariant holds', async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ healthy: true });
    expect(mocks.rpc).toHaveBeenCalledWith('get_merchant_signup_policy_health');
    expect(mocks.loggerError).not.toHaveBeenCalled();
    expect(mocks.recordHealthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        failedInvariants: [],
        outcome: 'healthy',
        reason: 'all_invariants_healthy',
      })
    );
  });

  it('returns 503 and logs each failed invariant when policy drift is detected', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...healthyResult,
        auth_can_insert: false,
        select_policy_is_expected: false,
      },
      error: null,
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      healthy: false,
      failed_invariants: ['auth_can_insert', 'select_policy_is_expected'],
    });
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'mobile-onboarding deployment_fault',
      component: 'merchant_signup_policy_health',
      reason: 'policy_drift_detected',
      failedInvariants: ['auth_can_insert', 'select_policy_is_expected'],
    });
    expect(mocks.recordHealthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        failedInvariants: ['auth_can_insert', 'select_policy_is_expected'],
        outcome: 'degraded',
        reason: 'policy_drift_detected',
      })
    );
  });

  it.each(
    mobileV2Invariants
  )('returns 503 when mobile v2 invariant %s drifts', async (invariant) => {
    mocks.rpc.mockResolvedValue({
      data: { ...healthyResult, [invariant]: false },
      error: null,
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      healthy: false,
      failed_invariants: [invariant],
    });
  });

  it('returns 500 and preserves the Postgres code when the RPC fails', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'mobile-onboarding deployment_fault',
      component: 'merchant_signup_policy_health',
      reason: 'health_rpc_failed',
      pgCode: '42501',
    });
    expect(mocks.recordHealthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'unavailable',
        postgresCode: '42501',
        reason: 'health_rpc_failed',
      })
    );
  });

  it('returns 500 instead of reporting healthy for a malformed RPC result', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...healthyResult, can_read_slug: 'yes' },
      error: null,
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant signup health check failed',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_health_result' })
    );
  });

  it('returns 500 when the RPC omits a required mobile v2 invariant', async () => {
    const { staff_update_policy_is_expected: _omitted, ...incompleteResult } =
      healthyResult;
    mocks.rpc.mockResolvedValue({
      data: incompleteResult,
      error: null,
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant signup health check failed',
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_health_result' })
    );
  });

  it('returns 500 and logs the stable tag when the public client throws', async () => {
    mocks.createPublicClient.mockImplementation(() => {
      throw new Error('Public Supabase configuration is missing');
    });

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith({
      message: 'mobile-onboarding deployment_fault',
      component: 'merchant_signup_policy_health',
      reason: 'health_rpc_threw',
      errorName: 'Error',
    });
    expect(mocks.recordHealthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        outcome: 'unavailable',
        reason: 'health_rpc_threw',
      })
    );
  });

  it('returns the health failure without waiting for degraded telemetry', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    mocks.recordHealthTelemetry.mockReturnValue(new Promise(() => undefined));

    const response = await GET(cronRequest());

    expect(response.status).toBe(500);
    expect(mocks.recordHealthTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'unavailable',
        reason: 'health_rpc_failed',
      })
    );
  });
});
