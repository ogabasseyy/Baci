import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { hydrateCustomer } from './auth-customer-hydration';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

it('preserves the validated merchant binding required by native Oxygen ownership checks', async () => {
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const user: User = {
    id: '20000000-0000-4000-8000-000000000001',
    email: 'customer@example.invalid',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-11-05T00:00:00Z',
  };
  const row = {
    id: '30000000-0000-4000-8000-000000000001',
    merchant_id: merchantId,
    user_id: user.id,
    email: user.email,
    first_name: 'Test',
  };
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
  };
  jest
    .mocked(supabase.from)
    .mockReturnValue(chain as unknown as ReturnType<typeof supabase.from>);

  const customer = await hydrateCustomer({
    merchantId,
    user,
    useTimeout: false,
  });

  expect(chain.eq).toHaveBeenCalledWith('merchant_id', merchantId);
  expect(chain.eq).toHaveBeenCalledWith('user_id', user.id);
  expect(customer).toMatchObject({ merchant_id: merchantId, user_id: user.id });
});
