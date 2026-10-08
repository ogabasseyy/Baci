import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIntakeHandler } from './intake-handler';
import { intakeSchema } from './intake-schema';

const integrationToken = 'ab'.repeat(32);
const providerSecret = 'synthetic-provider-secret';
const encryptionKey = Buffer.alloc(32, 7);
const receiptId = '4f8c66db-679d-4c38-9c26-b0871f6d0486';
const receipt = {
  receiptId,
  duplicate: false,
  durable: true as const,
  signatureStored: true as const,
};
const payload = Buffer.from([0xff, 0x00, 0x7b, 0x0a]);

function setup() {
  const persist = vi.fn<Parameters<typeof createIntakeHandler>[0]['persist']>(
    async () => receipt
  );
  const deps = { integrationToken, providerSecret, encryptionKey, persist };
  const handler = createIntakeHandler(deps);
  const request = new IncomingMessage(new Socket());
  request.url = '/piggyvest/intake';
  request.method = 'POST';
  request.headers.authorization = `Bearer ${integrationToken}`;
  request.headers['x-pvb-signature'] = createHmac('sha512', providerSecret)
    .update(payload)
    .digest('hex');
  const response = new ServerResponse(request);
  const end = vi.spyOn(response, 'end').mockReturnValue(response);
  const run = async (body = payload) => {
    request.push(body);
    request.push(null);
    await handler(request, response);
    return JSON.parse(String(end.mock.calls[0]?.[0]));
  };
  return { deps, handler, request, response, end, persist, run };
}

afterEach(() => vi.restoreAllMocks());

describe('encrypted durable staging intake', () => {
  it('fails closed before persistence when sealed validation fails', async () => {
    const context = setup();
    vi.spyOn(intakeSchema, 'parse').mockImplementation(() => {
      throw new Error('synthetic validation failure');
    });
    expect(await context.run()).toEqual({ error: 'Intake unavailable' });
    expect(context.response.statusCode).toBe(503);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it('quarantines signed junk and decrypts exact bytes only with the correct AAD', async () => {
    const context = setup();
    expect(await context.run()).toEqual({
      received: true,
      receiptId,
      duplicate: false,
      durable: true,
      processing: 'quarantined',
    });
    const record = context.persist.mock.calls[0][0];
    expect(record.payloadSha256).toBe(
      createHash('sha256').update(payload).digest('hex')
    );
    expect(record.keyVersion).toBe('staging-v1');
    expect(record.originalSignature).toBe(
      context.request.headers['x-pvb-signature']
    );
    expect(Buffer.from(record.nonce, 'base64')).toHaveLength(12);
    expect(Buffer.from(record.authTag, 'base64')).toHaveLength(16);
    const decrypt = (aad: string) => {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        Buffer.from(record.nonce, 'base64')
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]);
    };
    expect(
      decrypt(`piggyvest-staging:staging-v1:${record.payloadSha256}`)
    ).toEqual(payload);
    expect(() => decrypt('wrong-aad')).toThrow();
  });

  it.each([
    undefined,
    '',
    'x'.repeat(128),
    'a'.repeat(127),
    'a'.repeat(128),
  ])('rejects invalid signature %s without storage', async (signature) => {
    const context = setup();
    context.request.headers['x-pvb-signature'] = signature;
    expect(await context.run()).toEqual({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
    expect(context.response.statusCode).toBe(200);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it('rejects altered raw bytes', async () => {
    const context = setup();
    await context.run(Buffer.concat([payload, Buffer.from(' ')]));
    expect(context.persist).not.toHaveBeenCalled();
  });

  it('retains uppercase provider header and never echoes it publicly', async () => {
    const context = setup();
    const signature = String(
      context.request.headers['x-pvb-signature']
    ).toUpperCase();
    context.request.headers['x-pvb-signature'] = signature;
    const response = await context.run();
    expect(context.persist.mock.calls[0][0].originalSignature).toBe(signature);
    expect(JSON.stringify(response)).not.toContain(signature);
    expect(response).not.toHaveProperty('originalSignature');
  });

  it('rejects a valid signature with a trailing newline', async () => {
    const context = setup();
    context.request.headers['x-pvb-signature'] += '\n';
    expect(await context.run()).toMatchObject({ received: false });
    expect(context.persist).not.toHaveBeenCalled();
  });

  it('persists each duplicate delivery with fresh encryption and stable hash', async () => {
    const first = setup();
    await first.run();
    const second = setup();
    second.persist.mockResolvedValue({ ...receipt, duplicate: true });
    expect(await second.run()).toMatchObject({
      duplicate: true,
      durable: true,
    });
    expect(first.persist).toHaveBeenCalledTimes(1);
    expect(second.persist).toHaveBeenCalledTimes(1);
    expect(first.persist.mock.calls[0]).toEqual([
      expect.objectContaining({
        payloadSha256: createHash('sha256').update(payload).digest('hex'),
      }),
    ]);
    expect(first.persist.mock.calls[0]).not.toEqual(
      second.persist.mock.calls[0]
    );
  });

  it('waits for durable persistence before responding', async () => {
    const context = setup();
    let finish: (value: typeof receipt) => void = () => {};
    context.persist.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const running = context.run();
    await vi.waitFor(() => expect(context.persist).toHaveBeenCalledOnce());
    expect(context.end).not.toHaveBeenCalled();
    finish(receipt);
    await running;
  });

  it('returns a generic storage failure without sensitive logs', async () => {
    const spies = ['log', 'error', 'warn', 'info', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => {})
    );
    const context = setup();
    context.persist.mockRejectedValue(new Error(providerSecret));
    expect(await context.run()).toEqual({ error: 'Intake unavailable' });
    expect(context.response.statusCode).toBe(503);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...receipt, receiptId: 'invalid' },
    { ...receipt, receiptId: `${receiptId}\n` },
    { ...receipt, duplicate: 'true' },
    { ...receipt, durable: false },
    { ...receipt, signatureStored: false },
    { receiptId, duplicate: false, durable: true },
  ])('rejects malformed storage receipts', async (invalid) => {
    const context = setup();
    context.persist.mockResolvedValue(invalid as typeof receipt);
    await context.run();
    expect(context.response.statusCode).toBe(503);
  });

  it.each([
    undefined,
    '',
    'Basic secret',
    'Bearer xx',
    `Bearer ${'cd'.repeat(32)}`,
    `Bearer ${integrationToken}\n`,
  ])('rejects token failure without storage', async (authorization) => {
    const context = setup();
    context.request.headers.authorization = authorization;
    await context.run();
    expect(context.response.statusCode).toBe(401);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it('rejects a streamed body over one MiB without trusting content-length', async () => {
    const context = setup();
    context.request.headers['content-length'] = '1';
    const running = context.handler(context.request, context.response);
    context.request.push(Buffer.alloc(1024 * 1024));
    context.request.push(Buffer.alloc(1));
    await running;
    expect(context.response.statusCode).toBe(413);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it.each(['error', 'aborted', 'close'])('handles stream %s', async (event) => {
    const context = setup();
    const running = context.handler(context.request, context.response);
    context.request.emit(event, new Error(providerSecret));
    await running;
    expect(context.response.statusCode).toBe(503);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it.each([
    Buffer.alloc(0),
    Buffer.alloc(1024 * 1024),
  ])('accepts signed boundary-sized bodies', async (body) => {
    const context = setup();
    context.request.headers['x-pvb-signature'] = createHmac(
      'sha512',
      providerSecret
    )
      .update(body)
      .digest('hex');
    await context.run(body);
    expect(context.response.statusCode).toBe(200);
    expect(context.persist).toHaveBeenCalledOnce();
  });

  it.each([
    ['GET', '/piggyvest/intake', 405],
    ['POST', '/elsewhere', 404],
    ['POST', '/piggyvest/intake?other=true', 404],
  ])('restricts route and method', async (method, url, status) => {
    const context = setup();
    context.request.method = method;
    context.request.url = url;
    await context.run();
    expect(context.response.statusCode).toBe(status);
    expect(context.persist).not.toHaveBeenCalled();
  });

  it.each([
    { integrationToken: 'short' },
    { integrationToken: 'z'.repeat(64) },
    { integrationToken: `${integrationToken}\n` },
    { providerSecret: ' ' },
    { encryptionKey: Buffer.alloc(31) },
    { persist: null },
  ])('rejects malformed startup configuration', (override) => {
    expect(() =>
      createIntakeHandler({
        ...setup().deps,
        ...override,
      } as Parameters<typeof createIntakeHandler>[0])
    ).toThrow('Invalid intake configuration');
  });
});
