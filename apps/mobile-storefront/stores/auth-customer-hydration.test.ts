import type { User } from '@supabase/supabase-js';
import { hydrateCustomer } from './auth-customer-hydration';

const mockUpdate = jest.fn();
const customer = {
  id: '00000000-0000-4000-8000-000000000789',
  email: 'test@example.com',
  first_name: null,
  last_name: null,
};
const mockChain = {
  select: jest.fn(),
  eq: jest.fn(),
  update: mockUpdate,
  maybeSingle: jest.fn(),
  single: jest.fn(),
};
jest.mock('../lib/supabase', () => ({
  supabase: { from: () => mockChain, rpc: jest.fn() },
}));
const saved = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  mockChain.select.mockReturnValue(mockChain);
  mockChain.eq.mockReturnValue(mockChain);
  mockUpdate.mockReturnValue(mockChain);
  mockChain.maybeSingle.mockResolvedValue({ data: customer, error: null });
  mockChain.single.mockResolvedValue({
    data: { ...customer, first_name: 'Jane', last_name: 'Doe' },
    error: null,
  });
});
afterEach(() => {
  process.env = { ...saved };
});
const input = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  user: {
    id: 'test-user',
    email: customer.email,
    user_metadata: { full_name: 'Jane Doe' },
    aud: 'authenticated',
    app_metadata: {},
    created_at: '2026-10-20T00:00:00Z',
  } satisfies User,
  useTimeout: false,
};

it('hydrates the existing sandbox customer without attempting blocked profile backfill', async () => {
  const result = await hydrateCustomer(input);
  expect(result?.id).toBe(customer.id);
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('preserves the normal production OAuth name backfill', async () => {
  delete process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
  const result = await hydrateCustomer(input);
  expect(mockUpdate).toHaveBeenCalledWith({
    first_name: 'Jane',
    last_name: 'Doe',
  });
  expect(result?.first_name).toBe('Jane');
});
