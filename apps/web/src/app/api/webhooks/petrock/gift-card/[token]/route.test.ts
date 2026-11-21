import { afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const token = 'a'.repeat(64);
const request = new Request('https://example.test', {
  method: 'POST',
  body: 'synthetic',
});

afterEach(() => vi.unstubAllEnvs());

it('does not acknowledge a callback as processed while polling is the only recovery mechanism', async () => {
  vi.stubEnv('GIFT_CARD_PETROCK_CALLBACK_TOKEN', token);
  const response = await POST(request, { params: Promise.resolve({ token }) });
  expect(response.status).toBe(503);
  expect(request.bodyUsed).toBe(false);
});

it('returns not found for an invalid token', async () => {
  vi.stubEnv('GIFT_CARD_PETROCK_CALLBACK_TOKEN', token);
  const response = await POST(request, {
    params: Promise.resolve({ token: 'b'.repeat(64) }),
  });
  expect(response.status).toBe(404);
});
