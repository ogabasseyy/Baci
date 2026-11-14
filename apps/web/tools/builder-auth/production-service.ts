import { Pool, type PoolConfig } from 'pg';
import { parseProductionAuthConfig } from './production-config.ts';
import { verifyProductionAuthDatabaseRole } from './production-role.ts';
import { deleteExpiredAuthRecords, startAuthRetention } from './retention.ts';
import { createBuilderAuthRuntime } from './runtime.ts';

type RuntimeSettings = Parameters<typeof createBuilderAuthRuntime>[0];
type Runtime = Awaited<ReturnType<typeof createBuilderAuthRuntime>>;
type Dependencies = {
  createPool(settings: PoolConfig): Pool;
  createRuntime(settings: RuntimeSettings): Promise<Runtime>;
};

/** Trusted startup only: callers supply private configuration, never HTTP input. */
export async function startProductionAuthBroker(
  input: unknown,
  deps: Dependencies = {
    createPool: (settings) => new Pool(settings),
    createRuntime: createBuilderAuthRuntime,
  }
) {
  const config = parseProductionAuthConfig(input);
  let pool: Pool | undefined;
  try {
    pool = deps.createPool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: true },
      max: 4,
      connectionTimeoutMillis: 10000,
      options: '-c role=baci_builder_auth_storage',
    });
    await verifyProductionAuthDatabaseRole(pool);
    const runtime = await deps.createRuntime({
      pool,
      provider: config.provider,
      vault: config.vault,
      upstream: config.upstream,
      supabase: config.supabase,
      connectionTtlSeconds: config.connectionTtlSeconds,
      // Owner disconnect uses the existing authenticated Baci dashboard/RLS path.
      // This broker endpoint is not a substitute for that authority.
      authenticateDisconnect: () =>
        Promise.reject(Error('DISCONNECT_NOT_AVAILABLE')),
    });
    const listener = await runtime.listenPrivate(config.socketPath);
    const stopRetention = startAuthRetention({
      run: async () => {
        await deleteExpiredAuthRecords(pool as Pool, 500);
      },
      schedule: (callback) => {
        const timer = setInterval(callback, 15 * 60 * 1000);
        timer.unref();
        return () => clearInterval(timer);
      },
    });
    let closing: Promise<void> | undefined;
    return {
      runtime,
      socketPath: config.socketPath,
      publicBinding: {
        supabase: config.supabase,
        jwks: {
          keys: config.provider.jwks.keys.map(
            ({ kty, crv, x, y, alg, kid }) => ({ kty, crv, x, y, alg, kid })
          ),
        },
      },
      close() {
        closing ??= (async () => {
          try {
            try {
              await listener.close();
            } finally {
              try {
                await stopRetention();
              } finally {
                await pool?.end();
              }
            }
          } catch {
            throw Error('AUTH_BROKER_SHUTDOWN_FAILED');
          }
        })();
        return closing;
      },
    };
  } catch {
    await pool?.end().catch(() => undefined);
    throw Error('AUTH_BROKER_STARTUP_FAILED');
  }
}
