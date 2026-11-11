import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { exportJWK, generateKeyPair } from 'jose';
import type { Pool, PoolConfig } from 'pg';
import { startProductionAuthBroker } from './production-service.ts';
import type { createBuilderAuthRuntime } from './runtime.ts';

async function fixture() {
  const key = await generateKeyPair('ES256', { extractable: true });
  return {
    databaseUrl:
      'postgresql://baci_builder_auth_storage.fixture:password@pooler.example.test:5432/postgres',
    socketPath: '/run/baci-builder-auth/broker.sock',
    clientId: 'baci-chatgpt-builder-v1',
    callback: 'https://chatgpt.com/connector_platform_oauth_redirect',
    cookieKeys: [randomBytes(32).toString('base64url')],
    signingKeys: [
      { ...(await exportJWK(key.privateKey)), alg: 'ES256', kid: 'fixture' },
    ],
    vault: {
      activeKeyId: 'v1',
      keys: { v1: randomBytes(32).toString('base64url') },
    },
    upstream: {
      issuer: 'https://project.supabase.co/auth/v1',
      clientId: 'inner-client',
      clientSecret: 'synthetic-client-secret',
    },
    supabase: {
      url: 'https://project.supabase.co',
      anonKey: 'sb_publishable_synthetic',
    },
    connectionTtlSeconds: 86400,
  };
}

test('starts only after broker construction and closes listener before database', async () => {
  const events: string[] = [];
  let poolConfig: PoolConfig | undefined;
  const service = await startProductionAuthBroker(await fixture(), {
    createPool: (settings) => {
      poolConfig = settings;
      return {
        end: async () => {
          events.push('pool-close');
        },
      } as unknown as Pool;
    },
    createRuntime: async (settings) => {
      events.push('runtime');
      assert.equal(settings.provider.issuer, 'https://mcp.usebaci.com');
      await assert.rejects(settings.authenticateDisconnect({} as never));
      return {
        listenPrivate: async (socketPath: string) => {
          events.push(`listen:${socketPath}`);
          return {
            close: async () => {
              events.push('listener-close');
            },
          };
        },
      } as unknown as Awaited<ReturnType<typeof createBuilderAuthRuntime>>;
    },
  });
  assert.deepEqual(poolConfig?.ssl, { rejectUnauthorized: true });
  assert.equal(poolConfig?.max, 4);
  await service.close();
  await service.close();
  assert.deepEqual(events, [
    'runtime',
    'listen:/run/baci-builder-auth/broker.sock',
    'listener-close',
    'pool-close',
  ]);
});

test('invalid config creates no pool and startup failure closes its pool', async () => {
  const config = await fixture();
  let created = 0;
  let closed = 0;
  const deps = {
    createPool: () => {
      created++;
      return {
        end: async () => {
          closed++;
        },
      } as unknown as Pool;
    },
    createRuntime: async () => {
      throw Error('private credential');
    },
  };
  await assert.rejects(
    startProductionAuthBroker(
      {
        ...config,
        databaseUrl: 'postgresql://postgres:password@host/postgres',
      },
      deps
    ),
    /INVALID_AUTH_CONFIG/
  );
  assert.equal(created, 0);
  await assert.rejects(
    startProductionAuthBroker(config, deps),
    (error: Error) => error.message === 'AUTH_BROKER_STARTUP_FAILED'
  );
  assert.equal(created, 1);
  assert.equal(closed, 1);
  await assert.rejects(
    startProductionAuthBroker(config, {
      ...deps,
      createPool: () => {
        throw Error('database credential');
      },
    }),
    (error: Error) => error.message === 'AUTH_BROKER_STARTUP_FAILED'
  );
  await assert.rejects(
    startProductionAuthBroker(config, {
      ...deps,
      createRuntime: async () =>
        ({
          listenPrivate: async () => {
            throw Error('socket unavailable');
          },
        }) as unknown as Awaited<ReturnType<typeof createBuilderAuthRuntime>>,
    }),
    (error: Error) => error.message === 'AUTH_BROKER_STARTUP_FAILED'
  );
  assert.equal(created, 2);
  assert.equal(closed, 2);
});

test('closes the pool and redacts listener errors during shutdown', async () => {
  let closed = false;
  const service = await startProductionAuthBroker(await fixture(), {
    createPool: () =>
      ({
        end: async () => {
          closed = true;
        },
      }) as unknown as Pool,
    createRuntime: async () =>
      ({
        listenPrivate: async () => ({
          close: async () => {
            throw Error('private shutdown detail');
          },
        }),
      }) as unknown as Awaited<ReturnType<typeof createBuilderAuthRuntime>>,
  });
  await assert.rejects(
    service.close(),
    (error: Error) => error.message === 'AUTH_BROKER_SHUTDOWN_FAILED'
  );
  assert.equal(closed, true);
});
