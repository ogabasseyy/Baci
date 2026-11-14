import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptLikeGig } from '@/lib/shipping/gigl-webhook-crypto.test-support';
import { giglWebhookEventJson } from '@/lib/shipping/gigl-webhook-event.test-support';
import { GET, POST } from './route';

vi.mock('server-only', () => ({}));

const expedite = vi.fn();
const createGiglWebhookExpediteClient = vi.fn((_env: unknown) => ({
  expedite,
}));
vi.mock('@/lib/shipping/gigl-webhook-expedite-client', () => ({
  createGiglWebhookExpediteClient: (env: unknown) =>
    createGiglWebhookExpediteClient(env),
}));

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const SECRET = 'test-registration-secret';
const USER_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const CHANNEL_CODE = 'IND000001';
const ACK = { status: 'success', message: 'Webhook received successfully' };

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request('https://ogabassey.com/api/webhooks/gigl', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  );
}

const validBody = (overrides: Record<string, unknown> = {}, secret = SECRET) =>
  encryptLikeGig(giglWebhookEventJson(overrides), secret);

async function snapshot(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe('POST /api/webhooks/gigl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GIGL_WEBHOOK_ENCRYPTION_SECRET', SECRET);
    vi.stubEnv('GIGL_WEBHOOK_USER_ID', USER_ID);
    vi.stubEnv('GIGL_WEBHOOK_CHANNEL_CODE', CHANNEL_CODE);
    expedite.mockResolvedValue({
      data: { matched: 1, expedited: 1 },
      error: null,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("acknowledges a valid delivery with GIG's expected body", async () => {
    const response = await post(validBody());

    expect(await snapshot(response)).toEqual({ status: 200, body: ACK });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(expedite).toHaveBeenCalledExactlyOnceWith('1349639673', 'MCRT');
  });

  it('acts on every GIG status and flags codes the tracker cannot map', async () => {
    await post(validBody({ StatusCode: 'MCRT' }));
    await post(validBody({ StatusCode: 'ZZNEW' }));
    await post(validBody({ StatusCode: null }));

    expect(expedite).toHaveBeenCalledTimes(3);
    expect(expedite.mock.calls.map(([, statusCode]) => statusCode)).toEqual([
      'MCRT',
      'ZZNEW',
      null,
    ]);
    expect(logger.info.mock.calls.map(([entry]) => entry.statusMapped)).toEqual(
      [true, false, null]
    );
  });

  it('accepts the payload sent as a JSON-quoted string', async () => {
    const response = await post(JSON.stringify(validBody()));

    expect(response.status).toBe(200);
    expect(expedite).toHaveBeenCalledWith('1349639673', 'MCRT');
  });

  it('acknowledges an unknown waybill without changing anything', async () => {
    expedite.mockResolvedValue({
      data: { matched: 0, expedited: 0 },
      error: null,
    });

    const response = await post(validBody({ Waybill: '7799999999' }));

    expect(await snapshot(response)).toEqual({ status: 200, body: ACK });
  });

  it('acknowledges a duplicate delivery as a no-op', async () => {
    expedite
      .mockResolvedValueOnce({
        data: { matched: 1, expedited: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { matched: 1, expedited: 0 },
        error: null,
      });
    const body = validBody();

    const first = await post(body);
    const second = await post(body);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(expedite).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ matched: 1, expedited: 0 })
    );
  });

  it('answers every decrypt, parse and account failure identically', async () => {
    const valid = validBody();
    const bytes = Buffer.from(valid, 'base64');
    bytes[bytes.length - 1] ^= 0x01;
    const failures = [
      validBody({}, 'attacker-secret'),
      bytes.toString('base64'),
      encryptLikeGig('not json', SECRET),
      validBody({ Waybill: '' }),
      validBody({ UserId: 'a1b2c3d4-0000-4000-8000-000000000999' }),
      validBody({ ChannelCode: 'IND999999' }),
      'plain text, not base64',
      '',
    ];

    const responses = [];
    for (const body of failures)
      responses.push(await snapshot(await post(body)));

    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(responses[0]).toEqual({
      status: 401,
      body: { error: 'Invalid webhook payload', code: 'GIGL_WEBHOOK_REJECTED' },
    });
    expect(expedite).not.toHaveBeenCalled();
  });

  it('fails closed before reading the body when settings are missing', async () => {
    vi.stubEnv('GIGL_WEBHOOK_ENCRYPTION_SECRET', '');

    const response = await post(validBody());

    expect(response.status).toBe(503);
    expect(createGiglWebhookExpediteClient).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before any decryption', async () => {
    const response = await post('A'.repeat(17 * 1024));

    expect(await snapshot(response)).toEqual({
      status: 413,
      body: { error: 'Payload too large', code: 'GIGL_WEBHOOK_TOO_LARGE' },
    });
    expect(expedite).not.toHaveBeenCalled();
  });

  it('asks GIG to retry when the worker capability is unusable', async () => {
    createGiglWebhookExpediteClient.mockImplementationOnce(() => {
      throw new Error('GIGL tracking worker database capability is invalid');
    });

    const response = await post(validBody());

    expect(response.status).toBe(503);
  });

  it('asks GIG to retry when the database call fails', async () => {
    expedite.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const response = await post(validBody());

    expect(response.status).toBe(503);
  });

  it.each([
    ['null', null],
    ['an array', [{ matched: 1, expedited: 1 }]],
    ['a partial object', { matched: 1 }],
  ])('asks GIG to retry when the database returns %s without an error', async (_label, data) => {
    expedite.mockResolvedValue({ data, error: null });

    const response = await post(validBody());

    expect(response.status).toBe(503);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('never logs the secret, raw body, addresses or account ids', async () => {
    const accepted = validBody();
    await post(accepted);
    await post(validBody({}, 'attacker-secret'));

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    for (const sensitive of [
      SECRET,
      accepted.slice(0, 40),
      'Sender Street',
      'Receiver Road',
      USER_ID,
      CHANNEL_CODE,
    ]) {
      expect(logged).not.toContain(sensitive);
    }
    expect(logged).toContain('1349639673');
  });
});

describe('GET /api/webhooks/gigl', () => {
  it('answers a reachability probe', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
