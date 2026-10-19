import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { acceptPiggyvestStagingWebhook } from './webhook-intake';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  secret: 'synthetic-signing-secret',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  rawByteSignatureVerified: true,
  durableAcknowledgementApproved: true,
};
const payload = JSON.stringify({
  eventId: 'synthetic-event',
  customer_id: 'synthetic-customer',
  eventType: 'synthetic.unsupported',
  eventCategory: 'synthetic',
  eventData: {},
  integrationId: 'untrusted-body-tenant',
});
function input(body = payload) {
  const rawPayload = Buffer.from(body);
  return {
    configuration,
    rawPayload,
    signature: createHmac('sha512', configuration.secret)
      .update(rawPayload)
      .digest('hex'),
    inbox: { enqueue: vi.fn(async () => 'accepted' as const) },
  };
}

describe('acceptPiggyvestStagingWebhook', () => {
  it.each([
    undefined,
    { ...configuration, environment: 'production' },
    { ...configuration, actualProjectId: 'different-project' },
    { ...configuration, rawByteSignatureVerified: false },
    { ...configuration, durableAcknowledgementApproved: false },
    { ...configuration, secret: '' },
  ])('fails closed before storage when activation is unverified', async (config) => {
    const request = { ...input(), configuration: config };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe('not_ready');
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('persists authenticated bytes with only the trusted integration identity', async () => {
    const request = input();
    expect(await acceptPiggyvestStagingWebhook(request)).toBe('accepted');
    expect(request.inbox.enqueue).toHaveBeenCalledExactlyOnceWith({
      integrationId: configuration.integrationId,
      eventId: 'synthetic-event',
      rawPayload: Uint8Array.from(request.rawPayload),
    });
  });

  it('rejects altered bytes rather than reserializing JSON', async () => {
    const request = input();
    request.rawPayload = Buffer.from(`${payload}\n`);
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_signature'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    'a'.repeat(128),
    'hookdeck-signature',
  ])('rejects missing or invalid provider signatures', async (signature) => {
    const request = { ...input(), signature };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_signature'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    '{"test":"ping"}',
    '{',
    '{}',
    'null',
  ])('rejects malformed or incomplete signed envelopes', async (body) => {
    const request = input(body);
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_payload'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects oversized payloads before persistence', async () => {
    const request = input('x'.repeat(65537));
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'payload_too_large'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    'duplicate',
    'conflict',
  ] as const)('preserves the atomic storage result %s', async (result) => {
    const request = {
      ...input(),
      inbox: { enqueue: vi.fn(async () => result) },
    };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(result);
  });

  it('does not report acceptance or leak errors when storage fails', async () => {
    const request = {
      ...input(),
      inbox: {
        enqueue: vi.fn(async () => {
          throw new Error('sensitive database detail');
        }),
      },
    };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'storage_unavailable'
    );
  });

  it('waits for durable storage before reporting acceptance', async () => {
    let commit: ((result: 'accepted') => void) | undefined;
    const persisted = new Promise<'accepted'>((resolve) => {
      commit = resolve;
    });
    const complete = vi.fn();
    const request = { ...input(), inbox: { enqueue: () => persisted } };
    const result = acceptPiggyvestStagingWebhook(request).then(complete);
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    commit?.('accepted');
    await result;
    expect(complete).toHaveBeenCalledWith('accepted');
  });

  it('snapshots caller-owned bytes before handing them to storage', async () => {
    const request = input();
    const inbox = {
      enqueue: async ({ rawPayload }: { rawPayload: Uint8Array }) => {
        request.rawPayload.fill(0);
        await Promise.resolve();
        expect(Buffer.from(rawPayload).toString()).toBe(payload);
        return 'accepted' as const;
      },
    };
    expect(await acceptPiggyvestStagingWebhook({ ...request, inbox })).toBe(
      'accepted'
    );
  });

  it('checks signatures before attempting to parse malformed JSON', async () => {
    expect(
      await acceptPiggyvestStagingWebhook({ ...input('{'), signature: null })
    ).toBe('invalid_signature');
  });

  it('rejects signed invalid UTF-8 instead of silently replacing bytes', async () => {
    const request = input();
    request.rawPayload[15] = 255;
    request.signature = createHmac('sha512', configuration.secret)
      .update(request.rawPayload)
      .digest('hex');
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_payload'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    '',
    {},
    [],
    new Uint8Array(),
  ])('rejects empty or non-byte raw input', async (rawPayload) => {
    const request = { ...input(), rawPayload };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_payload'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('accepts a valid signed payload at the exact byte limit', async () => {
    expect(
      await acceptPiggyvestStagingWebhook(input(payload.padEnd(65536, ' ')))
    ).toBe('accepted');
  });

  it('rejects an event ID exceeding the SQL byte limit before persistence', async () => {
    const request = input(payload.replace('synthetic-event', 'é'.repeat(257)));
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'invalid_payload'
    );
    expect(request.inbox.enqueue).not.toHaveBeenCalled();
  });

  it('fails closed on an unexpected storage result', async () => {
    const request = {
      ...input(),
      inbox: { enqueue: vi.fn().mockResolvedValue('unexpected') },
    };
    expect(await acceptPiggyvestStagingWebhook(request)).toBe(
      'storage_unavailable'
    );
  });
});
