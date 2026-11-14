import { Pool, type PoolConfig } from 'pg';
import { parseVerifierProductionConfig } from './production-config';
import { createLocalPinnedPublicObserver } from './public-verification-local';
import { startVerifierService } from './service';

/** Operator process only. Pool identity is verified by the service before bind. */
export async function startProductionVerifier(
  input: unknown,
  deps: { createPool(config: PoolConfig): Pool } = {
    createPool: (config) => new Pool(config),
  }
) {
  const config = parseVerifierProductionConfig(input);
  let pool: Pool | undefined;
  try {
    pool = deps.createPool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: true },
      max: 4,
      connectionTimeoutMillis: 10000,
      options: '-c role=baci_experience_verifier',
    });
    const publicVerification =
      config.publicObserver === 'co-located'
        ? {
            rootDomain: config.rootDomain,
            observe: await createLocalPinnedPublicObserver({
              productOrigin: config.supabase.url,
              toolchainDigest: config.runner.toolchainDigest,
            }),
          }
        : undefined;
    const service = await startVerifierService({
      ...config,
      pool,
      ...(publicVerification ? { publicVerification } : {}),
    });
    let closing: Promise<void> | undefined;
    return {
      close() {
        closing ??= (async () => {
          try {
            try {
              await service.close();
            } finally {
              await pool?.end();
            }
          } catch {
            throw Error('VERIFIER_SHUTDOWN_FAILED');
          }
        })();
        return closing;
      },
    };
  } catch {
    await pool?.end().catch(() => undefined);
    throw Error('VERIFIER_STARTUP_FAILED');
  }
}
