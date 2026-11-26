import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { BuilderLifecycleError } from '@/lib/experience/builder-lifecycle-error';
import { createVerifierAttestationClient } from '@/lib/experience/verifier-attestation-client';
import {
  createOwnerPreviewNonceStore,
  ownerPreviewNonceDeadlines,
} from '../builder-auth/owner-preview-nonce';
import { createTransientOutputStore } from '../experience-runner/transient-output-store';
import { createVerifierLoopbackForwarder } from '../experience-verifier/loopback-forwarder';
import { createBuilderDraftApproval } from './approval';
import { startProductionBuilderFromPrivateConfig } from './boot';
import { parseBuilderProductionConfig } from './production-config';
import {
  createPublishedRendererReader,
  rendererDatabaseDeadlines,
} from './published-renderer-reader';

/** Private operator startup. No public listener is bound here. */
export async function startProductionBuilder(input: unknown) {
  let pool: Pool | undefined;
  let rendererPool: Pool | undefined;
  const closePools = () => Promise.all([pool?.end(), rendererPool?.end()]);
  let phase: ConstructorParameters<typeof BuilderLifecycleError>[1] =
    'configuration';
  try {
    const config = parseBuilderProductionConfig(input);
    phase = 'nonce-store';
    pool = new Pool({
      connectionString: config.previewDatabaseUrl,
      ssl: { rejectUnauthorized: true },
      max: 4,
      ...ownerPreviewNonceDeadlines,
      options: '-c role=baci_owner_preview_nonce',
    });
    const consumeNonce = await createOwnerPreviewNonceStore(pool, {
      requireDeadlines: true,
    });
    phase = 'renderer-store';
    rendererPool = new Pool({
      connectionString: config.rendererDatabaseUrl,
      ssl: { rejectUnauthorized: true },
      max: 4,
      ...rendererDatabaseDeadlines,
      options: '-c role=baci_experience_renderer_reader',
    });
    const readPublishedRenderer =
      await createPublishedRendererReader(rendererPool);
    const forwardAttestation = createVerifierLoopbackForwarder(
      config.verifierPort
    );
    phase = 'stack';
    const service = await startProductionBuilderFromPrivateConfig({
      port: config.port,
      deliveryPort: config.deliveryPort,
      ownerPort: config.ownerPort,
      authPort: config.authPort,
      verifierPort: config.verifierPort,
      verifierKey: config.verifierKey,
      ...(config.backgroundBuilds && {
        backgroundWorker: {
          schedule: (callback: () => void) => {
            const timer = setInterval(callback, 5000);
            timer.unref();
            return () => clearInterval(timer);
          },
        },
      }),
      ownerBridge: { key: config.previewKey, consumeNonce },
      rootDomain: config.rootDomain,
      expectedSupabase: config.supabase,
      integration: {
        hostOrigin: config.hostOrigin,
        executionOrigin: config.executionOrigin,
        artifactDirectory: config.artifactDirectory,
        readPublishedRenderer,
        publicClient: createClient(
          config.supabase.url,
          config.supabase.anonKey,
          {
            auth: { persistSession: false, autoRefreshToken: false },
          }
        ),
        approval: createBuilderDraftApproval(
          createVerifierAttestationClient({
            key: config.verifierKey,
            fetch: async (input, init) => {
              if (
                input !==
                'https://owner.baci-internal.invalid/internal/owner/attest'
              )
                throw Error('INVALID_VERIFIER_TARGET');
              return await forwardAttestation(
                new Request(
                  'https://verifier.baci-internal.invalid/v1/attest',
                  init
                )
              );
            },
          })
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
          } catch (error) {
            await closePools().catch(() => undefined);
            if (error instanceof BuilderLifecycleError) throw error;
            throw new BuilderLifecycleError('BUILDER_SHUTDOWN_FAILED', 'stack');
          }
          try {
            await closePools();
          } catch {
            throw new BuilderLifecycleError(
              'BUILDER_SHUTDOWN_FAILED',
              'database-pool'
            );
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    await closePools().catch(() => undefined);
    if (error instanceof BuilderLifecycleError) throw error;
    throw new BuilderLifecycleError('BUILDER_STARTUP_FAILED', phase);
  }
}
