import { createHash, createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardLiveWebhook } from './live-webhook-relay';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

const rawBody = Buffer.from('{ "eventId": "fixture" }');
const signature = 'a'.repeat(128);
const config = {
  endpoint: 'https://live-intake.example.com/piggyvest/intake',
  integrationId: '11111111-1111-4111-8111-111111111111',
  relayToken: 'fixture-relay-token-with-at-least-32-characters',
  environment: 'production' as const,
};
const binding = {
  integrationId: config.integrationId,
  environment: 'production',
  bodyDigest: createHash('sha256').update(rawBody).digest('hex'),
};

function response(outcome = 'accepted', extra = {}) {
  return Response.json({ ...binding, outcome, ...extra });
}

describe('forwardLiveWebhook', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { status: 503 },
    { status: 200, headers: { 'content-length': '4097' } },
    { status: 200, headers: { 'content-length': 'invalid' } },
  ])('aborts transport when rejecting upstream headers before reading the body', async (options) => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream(), options));
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation,
    });
    expect(result.status).toBe(503);
    expect(fetchImplementation.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('bounds response-body reads when upstream headers arrive but the body stalls', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const upstream = new Response(new ReadableStream({ cancel }));
    const pending = forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation: vi.fn().mockResolvedValue(upstream),
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe(503);
    expect(cancel).toHaveBeenCalled();
  });

  it('returns retryably when fetch aborts at the transport deadline', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true }
          );
        })
    );
    const pending = forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation,
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect((await pending).status).toBe(503);
  });

  it.each([
    null,
    'malformed',
    `${signature},${signature}`,
  ])('rejects ambiguous signatures without forwarding', async (invalidSignature) => {
    const fetchImplementation = vi.fn();
    const result = await forwardLiveWebhook({
      rawBody,
      signature: invalidSignature,
      config,
      fetchImplementation,
    });
    expect(await result.json()).toEqual({ received: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'accepted',
    'duplicate',
    'quarantined',
  ])('acknowledges only a bound durable %s outcome', async (outcome) => {
    const fetchImplementation = vi.fn().mockResolvedValue(response(outcome));
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ received: true });
    const [url, options] = fetchImplementation.mock.calls[0];
    expect(url).toBe(config.endpoint);
    expect(options.body).toEqual(rawBody);
    expect(options.redirect).toBe('error');
    expect(options.headers['x-pvb-signature']).toBe(signature);
    expect(options.headers.Authorization).toBe(`Bearer ${config.relayToken}`);
  });

  it('normalizes an uppercase valid signature for the lowercase-only receiver without changing raw bytes', async () => {
    const secret = randomBytes(32).toString('hex');
    const uppercaseSignature = createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex')
      .toUpperCase();
    const fetchImplementation = vi.fn(
      async (_url: Parameters<typeof fetch>[0], options: RequestInit = {}) => {
        const headers = new Headers(options.headers);
        const receiverAccepts = verifyPiggyvestPayloadSignature({
          payload: new Uint8Array(
            await new Response(options.body).arrayBuffer()
          ),
          signature: headers.get('x-pvb-signature'),
          secret,
        });
        return response(receiverAccepts ? 'accepted' : 'invalid_signature');
      }
    );

    const result = await forwardLiveWebhook({
      rawBody,
      signature: uppercaseSignature,
      config,
      fetchImplementation,
    });

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ received: true });
    const options = fetchImplementation.mock.calls[0][1] ?? {};
    expect(new Headers(options.headers).get('x-pvb-signature')).toBe(
      uppercaseSignature.toLowerCase()
    );
    expect(options.body).toEqual(rawBody);
  });

  it('preserves explicit nonacceptance for an invalid signature', async () => {
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation: vi
        .fn()
        .mockResolvedValue(response('invalid_signature')),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ received: false });
  });

  it.each([
    response('accepted', { bodyDigest: 'b'.repeat(64) }),
    response('accepted', { environment: 'staging' }),
    response('accepted', { integrationId: 'other' }),
    response('unknown'),
    response('unavailable'),
    Response.json({ received: true }),
    new Response('<html>bad gateway</html>'),
    new Response('redirect', { status: 302 }),
    new Response('unavailable', { status: 503 }),
    new Response('x'.repeat(4097)),
  ])('fails retryably for an invalid upstream acknowledgement', async (upstream) => {
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation: vi.fn().mockResolvedValue(upstream),
    });
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(config.relayToken);
  });

  it.each([
    { ...config, endpoint: 'not-a-url' },
    { ...config, endpoint: 'http://live-intake.example.com/piggyvest/intake' },
    {
      ...config,
      endpoint:
        'https://user:password@live-intake.example.com/piggyvest/intake',
    },
    {
      ...config,
      endpoint: 'https://live-intake.example.com/piggyvest/intake?token=secret',
    },
    { ...config, environment: 'staging' },
    { ...config, relayToken: '' },
  ])('does not send credentials with invalid configuration', async (invalidConfig) => {
    const fetchImplementation = vi.fn();
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config: invalidConfig,
      fetchImplementation,
    });
    expect(result.status).toBe(503);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    Buffer.alloc(0),
    Buffer.alloc(65537),
  ])('rejects invalid body bounds before forwarding', async (body) => {
    const fetchImplementation = vi.fn();
    const result = await forwardLiveWebhook({
      rawBody: body,
      signature,
      config,
      fetchImplementation,
    });
    expect(result.status).toBe(413);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not leak a transport error containing credentials', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await forwardLiveWebhook({
      rawBody,
      signature,
      config,
      fetchImplementation: vi
        .fn()
        .mockRejectedValue(new Error(config.relayToken)),
    });
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(config.relayToken);
    expect(warn).toHaveBeenCalledWith('[PiggyVest relay] Request unavailable', {
      timedOut: false,
    });
  });
});
