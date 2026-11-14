import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createVerifierPublicClient } from './verifier-public-client';

const key = Buffer.alloc(32, 7);
const approvalId = '11111111-1111-4111-8111-111111111111';
const client = {
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: { access_token: 'synthetic.jwt.token' } },
      error: null,
    })),
    getUser: vi.fn(async () => ({
      data: { user: { id: 'synthetic' } },
      error: null,
    })),
  },
};

it('sends only the authenticated owner and approval id under a dedicated signature', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const verify = createVerifierPublicClient({
    key,
    fetch,
    now: () => 1700000000000,
  });
  await verify(client as never, {
    approvalId,
    receiptId: 'must-not-be-trusted',
  });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://mcp.usebaci.com/internal/owner/public');
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({
    approvalId,
    accessToken: 'synthetic.jwt.token',
    expiresAt: 1700000030000,
  });
  expect(body.receiptId).toBeUndefined();
  expect(
    (init.headers as Record<string, string>)['x-baci-verifier-signature']
  ).toBe(
    createHmac('sha256', key)
      .update(`verifier-public/v1\n${init.body}`)
      .digest('hex')
  );
});

it('fails closed for invalid identifiers, unverified users and non-success responses', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  const verify = createVerifierPublicClient({ key, fetch });
  await expect(
    verify(client as never, { approvalId: 'bad' })
  ).rejects.toThrow();
  const invalid = {
    auth: {
      ...client.auth,
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  };
  await expect(verify(invalid as never, { approvalId })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await expect(verify(client as never, { approvalId })).rejects.toThrow();
});
