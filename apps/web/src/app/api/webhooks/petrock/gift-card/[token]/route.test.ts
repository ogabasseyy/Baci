import { afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const token = 'a'.repeat(64);
const request = new Request('https://example.test', {
  method: 'POST',
  body: 'synthetic',
});

afterEach(() => vi.unstubAllEnvs());

it('discards callbacks without reading the body or requesting a retry', async () => {
  vi.stubEnv('GIFT_CARD_PETROCK_CALLBACK_TOKEN', token);
  const response = await POST(request, { params: Promise.resolve({ token }) });
  expect(response.status).toBe(204);
  expect(response.headers.has('Retry-After')).toBe(false);
  expect(request.bodyUsed).toBe(false);
});

it('returns not found for an invalid token', async () => {
  vi.stubEnv('GIFT_CARD_PETROCK_CALLBACK_TOKEN', token);
  const response = await POST(request, {
    params: Promise.resolve({ token: 'b'.repeat(64) }),
  });
  expect(response.status).toBe(404);
});
