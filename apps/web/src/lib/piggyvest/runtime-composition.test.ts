import { describe, expect, it, vi } from 'vitest';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { createPiggyvestRuntimeComposition } from './runtime-composition';

vi.mock('server-only', () => ({}));

function fixture() {
  const source = cancellationRecoveryFixture();
  const createRlsClient = vi.fn(async () => source.options.supabase);
  const options = {
    origin: 'http://127.0.0.1:55444',
    configuration: {
      mode: 'local_test',
      goalId: source.goalId,
      context: source.options.configuration,
      termsDocument: {
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text: 'Synthetic only',
      },
    },
    createRlsClient,
    execute: source.execute,
  };
  return { ...source, options, createRlsClient };
}

describe('isolated HTTP composition routing', () => {
  it('rejects a different Supabase project before constructing any request client or fetch', () => {
    const setup = fixture();
    const authenticationFetch = vi.fn<typeof fetch>();
    const configuration = {
      ...setup.options.configuration,
      context: {
        ...setup.options.configuration.context,
        expectedProjectId: 'aaaaaaaaaaaaaaaaaaaa',
        actualProjectId: 'aaaaaaaaaaaaaaaaaaaa',
      },
    };
    const options = {
      ...setup.options,
      configuration,
      createRlsClient: undefined,
      authenticationFetch,
      authentication: {
        url: 'https://bbbbbbbbbbbbbbbbbbbb.supabase.co',
        publicKey: `sb_publishable_${'a'.repeat(20)}`,
      },
    };
    expect(() => createPiggyvestRuntimeComposition(options)).toThrow();
    expect(authenticationFetch).not.toHaveBeenCalled();
    expect(() =>
      createPiggyvestRuntimeComposition({
        ...options,
        authentication: {
          url: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
          publicKey: `sb_publishable_${'a'.repeat(20)}`,
        },
      })
    ).not.toThrow();
    expect(authenticationFetch).not.toHaveBeenCalled();
    const loopback = {
      url: 'http://127.0.0.1:55555',
      publicKey: `sb_publishable_${'a'.repeat(20)}`,
    };
    expect(() =>
      createPiggyvestRuntimeComposition({
        ...options,
        authentication: loopback,
      })
    ).toThrow();
    expect(() =>
      createPiggyvestRuntimeComposition({
        ...options,
        authentication: { ...loopback, syntheticLoopback: true },
      })
    ).not.toThrow();
    expect(authenticationFetch).not.toHaveBeenCalled();
  });
  it('denies absent configuration before creating an RLS client', () => {
    const setup = fixture();
    expect(() =>
      createPiggyvestRuntimeComposition({
        ...setup.options,
        configuration: null,
      })
    ).toThrow('Local savings runtime unavailable');
    expect(setup.createRlsClient).not.toHaveBeenCalled();
  });

  it('routes actual recovery with ownership checks and no private serialization', async () => {
    const setup = fixture();
    const app = createPiggyvestRuntimeComposition(setup.options);
    const response = await app(
      new Request(
        `${setup.options.origin}/recovery?goalId=${setup.goalId}&operationId=${setup.operationId}`
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(setup.prepared);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps malformed dependency output unknown and redacts private fields', async () => {
    const setup = fixture();
    setup.execute.mockResolvedValue({
      rows: [
        {
          result: {
            ...setup.prepared,
            providerSecret: 'private-synthetic-marker',
          },
        },
      ],
    });
    const response = await createPiggyvestRuntimeComposition(setup.options)(
      new Request(`${setup.options.origin}/recovery?goalId=${setup.goalId}`)
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain('private-synthetic-marker');
    expect(JSON.parse(body)).toMatchObject({
      status: 'unavailable',
      reservation: 'may_be_retained',
      retry: 'not_authorized',
    });
  });

  it.each([
    '/not-connected',
    '/cancel/',
    '/api/auth/cancel',
  ])('does not expose unregistered route %s', async (path) => {
    const setup = fixture();
    const response = await createPiggyvestRuntimeComposition(setup.options)(
      new Request(`${setup.options.origin}${path}`)
    );
    expect(response.status).toBe(404);
    expect(setup.createRlsClient).not.toHaveBeenCalled();
  });

  it('rejects bearer spoofing instead of bypassing cookie CSRF', async () => {
    const setup = fixture();
    const response = await createPiggyvestRuntimeComposition(setup.options)(
      new Request(`${setup.options.origin}/cancel`, {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic' },
      })
    );
    expect(response.status).toBe(403);
    expect(setup.execute).not.toHaveBeenCalled();
  });

  it('checks auth before reading a protected body', async () => {
    const setup = fixture();
    setup.getUser.mockResolvedValue({
      data: { user: { id: '' } },
      error: null,
    });
    const response = await createPiggyvestRuntimeComposition(setup.options)(
      new Request(`${setup.options.origin}/policy`, {
        method: 'POST',
        body: 'invalid',
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(response.status).toBe(401);
    expect(setup.from).not.toHaveBeenCalled();
  });

  it('requires a same-origin POST and actual double-submit CSRF', async () => {
    const setup = fixture();
    const app = createPiggyvestRuntimeComposition(setup.options);
    const cases: HeadersInit[] = [
      {},
      { origin: 'http://127.0.0.1:1' },
      {
        origin: setup.options.origin,
        cookie: 'csrf-token=synthetic',
        'x-csrf-token': 'wrong',
      },
    ];
    for (const headers of cases) {
      const response = await app(
        new Request(`${setup.options.origin}/cancel`, {
          method: 'POST',
          headers,
        })
      );
      expect(response.status).toBe(403);
    }
    expect(setup.execute).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods, cross-origin reads and already aborted work', async () => {
    const setup = fixture();
    const app = createPiggyvestRuntimeComposition(setup.options);
    expect(
      (
        await app(
          new Request(`${setup.options.origin}/recovery`, { method: 'POST' })
        )
      ).status
    ).toBe(405);
    expect(
      (
        await app(
          new Request(`${setup.options.origin}/recovery`, {
            headers: { origin: 'https://foreign.invalid' },
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await app(
          new Request(`${setup.options.origin}/recovery`, {
            signal: AbortSignal.abort(),
          })
        )
      ).status
    ).toBe(503);
    expect(setup.execute).not.toHaveBeenCalled();
  });
});
