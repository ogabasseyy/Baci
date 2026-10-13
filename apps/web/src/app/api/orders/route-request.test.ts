import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { POST } from './route';

const { authenticate, from, rpc } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: authenticate,
  hasPermission: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

it.each([
  '{',
  '',
  'undefined',
])('returns a safe 400 for malformed JSON (%j) before business data access', async (body) => {
  authenticate.mockResolvedValue({ supabase: { from, rpc }, user: null });
  const response = await POST(
    new NextRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: 'Invalid JSON request body',
    code: 'INVALID_JSON',
  });
  expect(from).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
