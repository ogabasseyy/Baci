import type { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { runAmendmentCommand } from './command';

const { authenticate, rpc } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: authenticate }));

it('rejects an invalid order identifier before dispatching an amendment read', async () => {
  authenticate.mockResolvedValueOnce({
    user: { id: 'fixture' },
    supabase: { rpc },
  });
  const request = new Request(
    'https://test.invalid/api/orders/invalid/amendments'
  ) as NextRequest;

  const response = await runAmendmentCommand(
    request,
    {
      params: Promise.resolve({ id: 'invalid' }),
    },
    'read'
  );

  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
