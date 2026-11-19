import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ error: null }),
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET, POST } from './route';

it('renders the opt-out form on the app origin without reading the database', async () => {
  mocks.createClient.mockClear();
  const response = await GET(
    new Request(
      'https://usebaci.com/onboarding/email-preferences?token=12345678-1234-4123-8123-123456789abc'
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('text/html');
  expect(mocks.createClient).not.toHaveBeenCalled();
});
it('uses the normal anonymous/session client only for the token-scoped opt-out RPC', async () => {
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  const token = '12345678-1234-4123-8123-123456789abc';
  const response = await POST(
    new Request('https://usebaci.com/onboarding/email-preferences', {
      method: 'POST',
      body: new URLSearchParams({ token }),
    })
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    'unsubscribe_merchant_onboarding_emails',
    { p_token: token }
  );
});
