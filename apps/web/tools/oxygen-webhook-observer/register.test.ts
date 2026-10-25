import { describe, expect, it, vi } from 'vitest';
import { registerStagingObserver } from './register';

describe('staging webhook registration', () => {
  const input = {
    callback: 'https://receiver.trycloudflare.com/oxygen-staging-hook',
    reference: 'test-reference',
    secret: 'test-secret',
  };
  it('updates with the persisted receiver credentials and top-level active flag', async () => {
    let sent: Record<string, unknown> = {};
    await registerStagingObserver(
      {
        ...input,
        operation: 'update',
        callbackCredentials: { apiKey: 'saved-key', apiSecret: 'saved-secret' },
      },
      {
        login: async () => 'private-token',
        fetchImpl: async (_url, init) => {
          sent = JSON.parse(String(init?.body));
          return new Response('{}');
        },
      }
    );
    expect(sent).toMatchObject({
      active: true,
      api_key: 'saved-key',
      api_secret: 'saved-secret',
    });
  });
  it('updates a known registration only when explicitly requested', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'));
    await registerStagingObserver(
      { ...input, operation: 'update' },
      { fetchImpl, login: vi.fn().mockResolvedValue('private-token') }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://staging-api.theoxygen.com/services/partners/api/v1/webhook-partners/update'
    );
  });
  it('registers once against staging, with fresh callback credentials', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const login = vi.fn().mockResolvedValue('private-token');
    expect(
      (await registerStagingObserver(input, { fetchImpl, login })).status
    ).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://staging-api.theoxygen.com/services/partners/api/v1/webhook-partners/create'
    );
    const body = JSON.parse(init.body);
    expect(body.webhook_url).toBe(input.callback);
    expect(body.api_secret).not.toBe(input.secret);
    expect(body.custom_headers['x-oxygen-probe']).toBe('baci-staging-observer');
  });
  it('rejects non-test callback URLs before authenticating', async () => {
    const login = vi.fn();
    await expect(
      registerStagingObserver(
        { ...input, callback: 'http://production.test/hook' },
        { fetchImpl: vi.fn(), login }
      )
    ).rejects.toThrow();
    expect(login).not.toHaveBeenCalled();
  });
  it('does not retry or echo a failed registration body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('{"secret":"private-value"}', { status: 400 })
      );
    const result = await registerStagingObserver(input, {
      fetchImpl,
      login: vi.fn().mockResolvedValue('private-token'),
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves a redacted 500 explanation and leaves registration unconfirmed', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      const payload = JSON.parse(init.body);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: `Webhook already exists for ${input.reference}; secret=${payload.api_secret}`,
            error: 'Internal Server Error',
            errors: { webhook_url: 'already registered' },
          }),
          {
            status: 500,
            headers: {
              'x-request-id': '123e4567-e89b-12d3-a456-426614174000',
              'set-cookie': 'private-cookie',
            },
          }
        )
      );
    });
    const result = await registerStagingObserver(input, {
      fetchImpl,
      login: vi.fn().mockResolvedValue('private-token'),
    });
    expect(result.registration).toBe('unconfirmed');
    expect(result.diagnostic?.message).toContain('Webhook already exists');
    expect(result.diagnostic?.error).toBe('Internal Server Error');
    expect(result.diagnostic?.shape).toMatchObject({
      errors: { webhook_url: 'string' },
    });
    expect(result.diagnostic?.requestId).toBe(
      '123e4567-e89b-12d3-a456-426614174000'
    );
    expect(JSON.stringify(result)).not.toContain(input.reference);
    expect(JSON.stringify(result)).not.toContain('private-cookie');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('confirms only a matching active registration receipt', async () => {
    const receipt = {
      id: 3,
      partnerReference: input.reference,
      webhookUrl: input.callback,
      active: true,
    };
    const result = await registerStagingObserver(input, {
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(receipt), { status: 200 })
        ),
      login: vi.fn().mockResolvedValue('private-token'),
    });
    expect(result.registration).toBe('confirmed');
    expect(JSON.stringify(result)).not.toContain(input.reference);
  });

  it('does not treat a mismatched or empty 200 as confirmed', async () => {
    for (const body of [
      '{}',
      '{"id":3,"partnerReference":"other","active":true}',
      'not json',
    ]) {
      const result = await registerStagingObserver(input, {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(body, { status: 200 })),
        login: vi.fn().mockResolvedValue('private-token'),
      });
      expect(result.registration).toBe('unconfirmed');
    }
  });

  it('retains HTTP status when response reading fails and never repeats the create', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('private-token'));
        },
      }),
      { status: 500 }
    );
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const result = await registerStagingObserver(input, {
      fetchImpl,
      login: vi.fn().mockResolvedValue('private-token'),
    });
    expect(result.status).toBe(500);
    expect(result.registration).toBe('unconfirmed');
    expect(result.diagnostic.body).toBe('unreadable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds an oversized provider response without retaining it', async () => {
    const result = await registerStagingObserver(input, {
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          new Response('private-value'.repeat(4000), { status: 500 })
        ),
      login: vi.fn().mockResolvedValue('private-token'),
    });
    expect(result.status).toBe(500);
    expect(result.diagnostic.body).toBe('oversized');
    expect(JSON.stringify(result)).not.toContain('private-value');
  });
});

it('accepts the deployed staging callback route and rejects other API paths', async () => {
  const login = vi.fn().mockResolvedValue('private-token');
  const fetchImpl = vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init.body));
    return Response.json({
      id: 1,
      partnerReference: body.partner_reference,
      webhookUrl: body.webhook_url,
      authType: 'API_KEY',
      active: true,
    });
  });
  const input = {
    operation: 'update' as const,
    callback: 'https://receiver.trycloudflare.com/api/payments/oxygen/webhook',
    reference: 'partner',
    secret: 'private',
    callbackCredentials: { apiKey: 'saved-key', apiSecret: 'saved-secret' },
  };
  const result = await registerStagingObserver(input, { login, fetchImpl });
  expect(result.registration).toBe('confirmed');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  await expect(
    registerStagingObserver(
      {
        ...input,
        callback:
          'https://receiver.trycloudflare.com/api/payments/oxygen/activate',
      },
      { login, fetchImpl }
    )
  ).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
