import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { resolvePiggyvestCustomerFundingCapability } from './customer-funding-capability';

vi.mock('server-only', () => ({}));

it('never constructs storage work when authenticated RLS context is absent', async () => {
  const execute = vi.fn();
  const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
  const from = vi.fn();
  expect(
    await resolvePiggyvestCustomerFundingCapability({
      supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
      goalId: '30000000-0000-4000-8000-000000000001',
      configuration: null,
      fundingConfiguration: null,
      execute,
    })
  ).toBeNull();
  expect(getUser).toHaveBeenCalledOnce();
  expect(from).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
