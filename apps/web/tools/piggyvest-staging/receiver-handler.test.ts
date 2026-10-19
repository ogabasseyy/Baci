import { createHmac } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import receiverHandler from './receiver-handler';

const payload = Buffer.from('{ "event": "synthetic" }\n');
const secret = 'test_key_Synthetic123';
const ingestToken = 'a1'.repeat(32);
const receipt = {
  received: true,
  durable: true,
  receiptId: '12345678-1234-4123-8123-123456789abc',
  duplicate: false,
  processing: 'quarantined',
};
const fetchMock = vi.fn();

function sign(body: Buffer) {
  return createHmac('sha512', secret).update(body).digest('hex');
}

async function invoke({
  method = 'POST',
  url = '/api/webhooks/piggyvest',
  body = payload,
  signature = sign(body),
  streamError = false,
}: {
  method?: string;
  url?: string;
  body?: Buffer;
  signature?: string | string[];
  streamError?: boolean;
} = {}) {
  const request = new IncomingMessage(new Socket());
  request.method = method;
  request.url = url;
  if (signature !== 'missing') request.headers['x-pvb-signature'] = signature;
  const response = new ServerResponse(request);
  const end = vi.spyOn(response, 'end').mockReturnValue(response);
  const pending = receiverHandler(request, response);
  if (streamError) request.destroy(new Error('sensitive stream failure'));
  else {
    for (let offset = 0; offset < body.length; offset += 65536) {
      request.push(body.subarray(offset, offset + 65536));
    }
    request.push(null);
  }
  await pending;
  const text = end.mock.calls[0]?.[0];
  return {
    request,
    response,
    text,
    body: typeof text === 'string' ? JSON.parse(text) : undefined,
  };
}

beforeEach(() => {
  vi.stubEnv('PVB_STAGING_REGISTRATION_PROJECT_ID', 'prj_synthetic');
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_synthetic');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PVB_INTEGRATION_ENV', 'staging');
  vi.stubEnv('PVB_SECRET_KEY', secret);
  vi.stubEnv('PVB_INGEST_TOKEN', ingestToken);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ status: 200, json: async () => receipt });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe('staging forwarding receiver', () => {
  it.each([
    'GET',
    'HEAD',
  ])('serves %s reachability without credentials', async (method) => {
    vi.stubEnv('PVB_SECRET_KEY', undefined);
    vi.stubEnv('PVB_INGEST_TOKEN', undefined);
    const result = await invoke({ method });
    expect(result.response.statusCode).toBe(200);
    if (method === 'GET')
      expect(result.body).toEqual({
        status: 'reachable',
        environment: 'staging',
        eventProcessing: 'quarantined',
      });
    else expect(result.text).toBeUndefined();
    expect(result.response.getHeader('Cache-Control')).toBe('no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'missing',
    '',
    'bad',
    'A'.repeat(128),
    'a'.repeat(127),
    'a'.repeat(129),
    '0'.repeat(128),
    ['a'.repeat(128)],
  ])('never forwards invalid signature %s', async (signature) => {
    const result = await invoke({ signature });
    expect(result.response.statusCode).toBe(200);
    expect(result.body).toEqual({ received: false, invalid: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'PVB_SECRET_KEY',
    'PVB_INGEST_TOKEN',
  ])('fails closed when signed delivery lacks %s', async (name) => {
    vi.stubEnv(name, undefined);
    expect((await invoke()).response.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['PVB_SECRET_KEY', 'live_key_Synthetic123'],
    ['PVB_SECRET_KEY', 'test_key_'],
    ['PVB_SECRET_KEY', 'test_key_has_underscore'],
    ['PVB_INGEST_TOKEN', 'A'.repeat(64)],
    ['PVB_INGEST_TOKEN', 'a'.repeat(63)],
    ['PVB_INGEST_TOKEN', 'a'.repeat(65)],
    ['PVB_INGEST_TOKEN', 'g'.repeat(64)],
  ])('rejects malformed staging credential %s=%s', async (name, value) => {
    vi.stubEnv(name, value);
    const result = await invoke();
    expect(result.response.statusCode).toBe(503);
    expect(result.body).toEqual({ error: 'Integration unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['PVB_STAGING_REGISTRATION_PROJECT_ID', ''],
    ['VERCEL_PROJECT_ID', 'prj_other'],
    ['VERCEL_ENV', 'preview'],
    ['PVB_INTEGRATION_ENV', 'production'],
  ])('denies incorrect staging binding %s', async (name, value) => {
    vi.stubEnv(name, value);
    expect((await invoke()).response.statusCode).toBe(503);
    expect((await invoke({ method: 'GET' })).response.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('relays a durable receipt with duplicate=%s and exact bytes', async (duplicate) => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ ...receipt, duplicate, private: 'do not relay' }),
    });
    const result = await invoke();
    expect(result.response.statusCode).toBe(200);
    expect(result.body).toEqual({ ...receipt, duplicate });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging-auth.ogabassey.com/piggyvest/intake',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ingestToken}`,
          'content-type': 'application/octet-stream',
          'x-pvb-signature': sign(payload),
        },
        body: payload,
        redirect: 'error',
        signal: expect.anything(),
      }
    );
  });

  it('rejects a signature for reserialized rather than exact bytes', async () => {
    expect(
      (
        await invoke({
          signature: sign(
            Buffer.from(JSON.stringify(JSON.parse(payload.toString())))
          ),
        })
      ).body
    ).toEqual({ received: false, invalid: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...receipt, durable: false },
    { ...receipt, durable: 'true' },
    { ...receipt, received: 1 },
    { ...receipt, duplicate: 'false' },
    { ...receipt, receiptId: 123 },
    { ...receipt, receiptId: 'not-uuid' },
    { ...receipt, processing: 'processed' },
  ])('rejects an invalid intake receipt', async (body) => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => body });
    const result = await invoke();
    expect(result.response.statusCode).toBe(503);
    expect(result.body).toEqual({ error: 'Integration unavailable' });
  });

  it.each([
    500, 503, 302, 201,
  ])('returns generic 503 for intake status %s including DB failure', async (status) => {
    const json = vi.fn().mockRejectedValue(new Error('database secret'));
    fetchMock.mockResolvedValue({ status, json });
    const result = await invoke();
    expect(result.response.statusCode).toBe(503);
    expect(result.body).toEqual({ error: 'Integration unavailable' });
    expect(json).not.toHaveBeenCalled();
  });

  it('handles network failure without leaking its error', async () => {
    fetchMock.mockRejectedValue(new Error('private token'));
    const result = await invoke();
    expect(result.response.statusCode).toBe(503);
    expect(result.body).toEqual({ error: 'Integration unavailable' });
  });

  it('handles malformed intake JSON', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => {
        throw new Error('private body');
      },
    });
    expect((await invoke()).response.statusCode).toBe(503);
  });

  it('uses a ten second timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await invoke();
    expect(timeout).toHaveBeenCalledWith(10000);
  });

  it('returns 503 on stream errors', async () => {
    expect((await invoke({ streamError: true })).response.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects streamed bodies over 1 MiB', async () => {
    expect(
      (await invoke({ body: Buffer.alloc(1024 * 1024 + 1) })).response
        .statusCode
    ).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drains an oversized request rather than leaving its stream paused', async () => {
    const request = new IncomingMessage(new Socket());
    request.method = 'POST';
    request.url = '/api/webhooks/piggyvest';
    request.headers['x-pvb-signature'] = 'a'.repeat(128);
    const response = new ServerResponse(request);
    vi.spyOn(response, 'end').mockReturnValue(response);
    const pending = receiverHandler(request, response);
    request.push(Buffer.alloc(1024 * 1024 + 1));
    await pending;
    request.push(Buffer.from('remaining synthetic bytes'));
    request.push(null);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(response.statusCode).toBe(413);
    expect(request.readableLength).toBe(0);
    expect(request.readableEnded).toBe(true);
  });

  it('accepts exactly 1 MiB of verified binary bytes', async () => {
    expect(
      (await invoke({ body: Buffer.alloc(1024 * 1024, 255) })).response
        .statusCode
    ).toBe(200);
  });

  it('limits the endpoint path and methods', async () => {
    expect((await invoke({ url: '/api/orders' })).response.statusCode).toBe(
      404
    );
    const result = await invoke({ method: 'DELETE' });
    expect(result.response.statusCode).toBe(405);
    expect(result.response.getHeader('Allow')).toBe('GET, HEAD, POST');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
