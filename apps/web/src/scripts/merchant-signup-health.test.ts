import { describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();

vi.mock('dotenv/config', () => ({}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/posthog/merchant-signup-health-telemetry', () => ({
  recordMerchantSignupHealthTelemetry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => ({ rpc: mockRpc }),
}));

import { runMerchantSignupHealthCli } from './merchant-signup-health';

const HEALTHY_FIXTURE = {
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
  mobile_provisioning_rpc_is_invoker: true,
  anon_cannot_execute_mobile_provisioning_rpc: true,
  public_cannot_execute_mobile_provisioning_rpc: true,
  domain_insert_policy_is_expected: true,
  staff_insert_policy_is_expected: true,
  staff_update_policy_is_expected: true,
  row_level_security_enabled: true,
  select_policy_is_expected: true,
  update_policy_allows_owner_or_staff: true,
};

describe('merchant-signup-health CLI', () => {
  it('returns 1 when RPC returns an error or incomplete payload, and 0 when all invariants pass', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'err' } });
    await expect(runMerchantSignupHealthCli()).resolves.toBe(1);

    mockRpc.mockResolvedValueOnce({ data: {}, error: null });
    await expect(runMerchantSignupHealthCli()).resolves.toBe(1);

    mockRpc.mockResolvedValueOnce({
      data: HEALTHY_FIXTURE,
      error: null,
    });
    await expect(runMerchantSignupHealthCli()).resolves.toBe(0);
  });
});
