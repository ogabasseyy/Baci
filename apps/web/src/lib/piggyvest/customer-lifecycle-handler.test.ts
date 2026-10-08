import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerLifecycleHandler } from './customer-lifecycle-handler';

vi.mock('server-only', () => ({}));
const uuid = '30000000-0000-4000-8000-000000000001';
it.each([
  'terms',
  'activate',
] as const)('authenticates %s first', async (method) => {
  const from = vi.fn();
  const csrf = vi.fn();
  const handler = createPiggyvestCustomerLifecycleHandler({
    supabase: {
      auth: { getUser: async () => ({ error: null, data: { user: null } }) },
      from,
    } as unknown as SupabaseClient,
    goalId: uuid,
    configuration: {},
    execute: vi.fn(),
    checkCsrfProtection: csrf,
  });
  expect(
    (
      await handler[method](
        new NextRequest(`http://localhost/lifecycle/${method}`, {
          method: 'POST',
        })
      )
    ).status
  ).toBe(401);
  expect(from).not.toHaveBeenCalled();
  expect(csrf).not.toHaveBeenCalled();
});
