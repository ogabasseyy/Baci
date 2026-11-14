import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { createVerifierAttestationClient } from '@/lib/experience/verifier-attestation-client';
import { createOwnerPreviewNonceStore } from '../builder-auth/owner-preview-nonce';
import { createTransientOutputStore } from '../experience-runner/transient-output-store';
import { createBuilderDraftApproval } from './approval';
import { startProductionBuilderFromPrivateConfig } from './boot';
import { parseBuilderProductionConfig } from './production-config';

/** Private operator startup. No public listener is bound here. */
export async function startProductionBuilder(input: unknown) {
  const config = parseBuilderProductionConfig(input);
  let pool: Pool | undefined;
  try {
    pool = new Pool({
      connectionString: config.previewDatabaseUrl,
      ssl: { rejectUnauthorized: true },
      max: 4,
      connectionTimeoutMillis: 10000,
      options: '-c role=baci_owner_preview_nonce',
    });
    const consumeNonce = await createOwnerPreviewNonceStore(pool);
    const service = await startProductionBuilderFromPrivateConfig({
      port: config.port,
      deliveryPort: config.deliveryPort,
      authPort: config.authPort,
      verifierPort: config.verifierPort,
      verifierKey: config.verifierKey,
      ...(config.backgroundBuilds
        ? {
            backgroundWorker: {
              schedule: (callback: () => void) => {
                const timer = setInterval(callback, 5000);
                timer.unref();
                return () => clearInterval(timer);
              },
            },
          }
        : {}),
      ownerBridge: { key: config.previewKey, consumeNonce },
      rootDomain: config.rootDomain,
      expectedSupabase: config.supabase,
      integration: {
        hostOrigin: config.hostOrigin,
        executionOrigin: config.executionOrigin,
        artifactDirectory: config.artifactDirectory,
        publicClient: createClient(
          config.supabase.url,
          config.supabase.anonKey,
          {
            auth: { persistSession: false, autoRefreshToken: false },
          }
        ),
        approval: createBuilderDraftApproval(
          createVerifierAttestationClient({ key: config.verifierKey })
        ),
        runner: config.runner,
        build: {
          key: config.buildKey,
          toolchainDigest: config.runner.toolchainDigest,
          transient: createTransientOutputStore(),
        },
      },
    });
    let closing: Promise<void> | undefined;
    return {
      close() {
        closing ??= (async () => {
          try {
            await service.close();
          } finally {
            await pool?.end();
          }
        })();
        return closing;
      },
    };
  } catch {
    await pool?.end().catch(() => undefined);
    throw Error('BUILDER_STARTUP_FAILED');
  }
}
