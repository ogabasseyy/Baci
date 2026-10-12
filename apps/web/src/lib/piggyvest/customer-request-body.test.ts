import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { readPiggyvestCustomerRequestBody } from './customer-request-body';

vi.mock('server-only', () => ({}));
it('reads bounded UTF8 JSON with exact declared byte length', async () => {
  const body = JSON.stringify({ text: '₦ synthetic' });
  const request = new NextRequest('https://synthetic.test/', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json; charset="utf-8"',
      'content-length': String(new TextEncoder().encode(body).byteLength),
    },
  });
  expect(await readPiggyvestCustomerRequestBody(request)).toEqual({
    text: '₦ synthetic',
  });
});
it.each([
  '{',
  ' '.repeat(4097),
])('rejects malformed or oversized bodies', async (body) => {
  const request = new NextRequest('https://synthetic.test/', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
  await expect(readPiggyvestCustomerRequestBody(request)).rejects.toThrow();
});
