// @vitest-environment node
import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOwnerPreviewBridge } from './owner-preview-bridge';

const key = new Uint8Array(32).fill(7);
const now = 1700000000000;
const merchantId = '10000000-0000-4000-8000-000000000001';
const buildId = '20000000-0000-4000-8000-000000000001';
const body = () => ({
  version: 1,
  nonce: 'a'.repeat(64),
  expiresAt: now + 30000,
  accessToken: 'synthetic.user.token',
  input: { merchantId, buildId, routeId: 'home' },
});
function request(input: unknown, signature?: string) {
  const text = JSON.stringify(input);
  return new Request('https://mcp.usebaci.com/internal/owner/preview', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-baci-owner-signature':
        signature ??
        createHmac('sha256', key)
          .update(`owner-preview/v1\n${text}`)
          .digest('hex'),
    },
    body: text,
  });
}
function fixture() {
  const seen = new Set<string>();
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'owner' } },
        error: null,
      })),
    },
    rpc: vi.fn(async () => ({ data: true, error: null })),
  };
  const resolve = vi.fn(async () => client as never);
  const launch = vi.fn(async () => ({ previewUrl: 'synthetic' }));
  const consumeNonce = vi.fn(async (nonce: string) => {
    if (seen.has(nonce)) return false;
    seen.add(nonce);
    return true;
  });
  const handler = createOwnerPreviewBridge({
    key,
    now: () => now,
    previewOrigin: 'https://builder.baci.test',
    consumeNonce,
    resolveUserClient: resolve,
    launch,
  });
  return { handler, client, resolve, launch, consumeNonce };
}
it('requires a signed fresh single-use request and verifies the user and owner before launch', async () => {
  const f = fixture();
  const response = await f.handler(request(body()));
  expect(response.status).toBe(200);
  expect(f.resolve).toHaveBeenCalledWith('synthetic.user.token');
  expect(f.client.auth.getUser).toHaveBeenCalled();
  expect(f.client.rpc).toHaveBeenCalledWith(
    'experience_authorize_read',
    expect.objectContaining({ p_merchant: merchantId })
  );
  expect(f.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId,
      requestOrigin: 'https://builder.baci.test',
    }),
    { buildId, routeId: 'home' }
  );
  expect((await f.handler(request(body()))).status).toBe(409);
  expect(f.launch).toHaveBeenCalledOnce();
});

it('accepts reordered wire fields signed using the validated schema order', async () => {
  const f = fixture();
  const original = body();
  const signed = createHmac('sha256', key)
    .update(`owner-preview/v1\n${JSON.stringify(original)}`)
    .digest('hex');
  const reordered = {
    input: {
      routeId: original.input.routeId,
      buildId: original.input.buildId,
      merchantId: original.input.merchantId,
    },
    accessToken: original.accessToken,
    expiresAt: original.expiresAt,
    nonce: original.nonce,
    version: original.version,
  };
  expect((await f.handler(request(reordered, signed))).status).toBe(200);
});
it('rejects forged, expired and malformed requests before user or database access', async () => {
  const f = fixture();
  expect((await f.handler(request(body(), '0'.repeat(64)))).status).toBe(401);
  expect(
    (await f.handler(request({ ...body(), expiresAt: now - 1 }))).status
  ).toBe(401);
  expect(
    (
      await f.handler(
        request({ ...body(), input: { ...body().input, merchantId: 'bad' } })
      )
    ).status
  ).toBe(400);
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.consumeNonce).not.toHaveBeenCalled();
});
it('rejects a non-owner without creating a preview and never returns internal errors', async () => {
  const f = fixture();
  f.client.rpc.mockResolvedValue({ data: false, error: null });
  const response = await f.handler(request(body()));
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('synthetic.user.token');
  expect(f.launch).not.toHaveBeenCalled();
});

it('does not return a preview when the owner loses access during launch', async () => {
  const f = fixture();
  f.client.rpc.mockResolvedValueOnce({ data: true, error: null });
  f.client.rpc.mockResolvedValueOnce({ data: false, error: null });
  const response = await f.handler(request(body()));
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('previewUrl');
  expect(f.launch).toHaveBeenCalledOnce();
});

it('fails closed when the durable replay store is unavailable', async () => {
  const f = fixture();
  f.consumeNonce.mockRejectedValue(Error('private store detail'));
  const response = await f.handler(request(body()));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private store detail');
  expect(f.resolve).not.toHaveBeenCalled();
});

it('does not resolve the user or start a preview after cancellation during nonce consumption', async () => {
  const f = fixture();
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.consumeNonce.mockImplementationOnce(async () => {
    entered();
    await gate;
    return true;
  });
  const controller = new AbortController();
  const result = f.handler(
    new Request(request(body()), { signal: controller.signal })
  );
  await started;
  controller.abort();
  release();
  expect((await result).status).toBe(503);
  expect(f.resolve).not.toHaveBeenCalled();
  expect(f.launch).not.toHaveBeenCalled();
});

it('does not return a preview when cancellation occurs during launch', async () => {
  const f = fixture();
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.launch.mockImplementationOnce(async () => {
    entered();
    await gate;
    return { previewUrl: 'synthetic' };
  });
  const controller = new AbortController();
  const result = f.handler(
    new Request(request(body()), { signal: controller.signal })
  );
  await started;
  controller.abort();
  release();
  const response = await result;
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('previewUrl');
  expect(f.client.auth.getUser).toHaveBeenCalledTimes(1);
});

it('reports a launch outage without exposing its details', async () => {
  const f = fixture();
  f.launch.mockRejectedValue(Error('private launch failure'));
  const response = await f.handler(request(body()));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private launch failure');
});

it('reports an unexpected owner authorization outage without exposing its details', async () => {
  const f = fixture();
  f.client.rpc.mockRejectedValue(Error('private authorization outage'));
  const response = await f.handler(request(body()));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private authorization outage');
  expect(f.launch).not.toHaveBeenCalled();
});
