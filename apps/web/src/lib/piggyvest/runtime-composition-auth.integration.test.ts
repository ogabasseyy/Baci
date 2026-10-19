// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

vi.mock('server-only', () => ({}));

it.skipIf(process.env.PIGGYVEST_RUN_RUNTIME_COMPOSITION !== '1')(
  'connects actual SSR cookie authentication, real HTTP, context queries and restricted PG screen reads',
  async () => {
    const fixture = cancellationRecoveryFixture();
    const goalId = '30000000-0000-4000-8000-000000000301';
    const authUrl = 'http://127.0.0.1:55555';
    const jwt = (payload: unknown) =>
      `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic`;
    const token = jwt({
      sub: fixture.actorId,
      role: 'authenticated',
      exp: 4102444800,
    });
    const session = {
      access_token: token,
      refresh_token: 'synthetic-refresh',
      expires_at: 4102444800,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: fixture.actorId },
    };
    const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
    const execute = vi.fn(
      createPiggyvestPostgresExecutor({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_policy_writer',
        port: 55444,
      })
    );
    const authenticationFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(authUrl);
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${token}`
      );
      if (url.pathname === '/auth/v1/user')
        return Response.json({ id: fixture.actorId, aud: 'authenticated' });
      const table = url.pathname.replace('/rest/v1/', '');
      const row =
        table === 'customer_savings_goals'
          ? {
              id: goalId,
              merchant_id: fixture.options.configuration.merchantId,
              customer_id:
                fixture.options.configuration.allowlistedCustomerIds[0],
            }
          : fixture.rows[table];
      if (!row) throw new Error('Unexpected synthetic RLS request');
      return Response.json([row]);
    });
    const server = await startPiggyvestRuntimeCompositionServer({
      port: 0,
      execute,
      authentication: {
        url: authUrl,
        publicKey: jwt({ role: 'anon' }),
        syntheticLoopback: true,
      },
      authenticationFetch,
      configuration: {
        mode: 'local_test',
        goalId,
        context: fixture.options.configuration,
        termsDocument: {
          version: 'synthetic-http-v1',
          text: 'Synthetic HTTP terms. Not a customer agreement.',
          hash: createHash('sha256')
            .update('Synthetic HTTP terms. Not a customer agreement.')
            .digest('hex'),
        },
      },
    });
    try {
      expect(
        (
          await fetch(`${server.origin}/csrf`, {
            headers: { origin: server.origin },
          })
        ).status
      ).toBe(401);
      const bootstrap = await fetch(`${server.origin}/csrf`, {
        headers: { origin: server.origin, cookie },
      });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.getSetCookie().join(';')).toContain(
        'piggyvest-csrf='
      );
      const response = await fetch(`${server.origin}/screen?goalId=${goalId}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'ready',
        goalId,
        policy: {
          device: { productName: 'Synthetic phone', variant: '256GB' },
        },
        funding: { status: 'unavailable' },
      });
      expect(execute).toHaveBeenCalled();
      expect(
        execute.mock.calls.every(([statement]) =>
          statement.includes('piggyvest_goal_policy.read(')
        )
      ).toBe(true);
      expect(authenticationFetch).toHaveBeenCalled();
    } finally {
      await server.close();
    }
  }
);
