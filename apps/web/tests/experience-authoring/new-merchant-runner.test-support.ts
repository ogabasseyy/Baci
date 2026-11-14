import type { PublicProduct } from '@baci/shared/experience';
import { vi } from 'vitest';
import { loadOwnerPreviewBootstrap } from '@/lib/experience/owner-preview-bootstrap';
import {
  type QualificationKind,
  runLocalQualification,
} from '../../tools/experience-runner/local-oci-executor';
import {
  createRunnerExecutor,
  createRunnerHandler,
} from '../../tools/experience-runner/runner-transport';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { createVerifierBuildRecorder } from '../../tools/experience-verifier/build-recorder';
import { createIndependentBuildVerifier } from '../../tools/experience-verifier/build-verifier';
import { createVerifierCaptureWorker } from '../../tools/experience-verifier/capture-worker';
import type { experienceDataFixture } from './data-fixture.test-support';
import { setupBuildVerification } from './verifier-build-loopback.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

/** Optional offline gVisor build; never performs performance measurement. */
export async function setupNewMerchantRunner(
  f: Awaited<ReturnType<typeof experienceDataFixture>>
) {
  const useLocalRunner =
    process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION === '1';
  const key = new Uint8Array(32).fill(1);
  const execute = vi.fn(async (kind: QualificationKind, payload: unknown) => {
    if (
      useLocalRunner &&
      ['prerender-build', 'prerender', 'capture'].includes(kind)
    ) {
      const started = Date.now();
      process.stderr.write(`SYNTHETIC_RUNNER ${kind} started\n`);
      try {
        const result = await runLocalQualification(kind, payload);
        process.stderr.write(
          `SYNTHETIC_RUNNER ${kind} completed ${Date.now() - started}ms\n`
        );
        return result;
      } catch (error) {
        process.stderr.write(
          `SYNTHETIC_RUNNER ${kind} failed ${error instanceof Error ? error.name : 'unknown'} ${Date.now() - started}ms\n`
        );
        throw error;
      }
    }
    throw Error('SYNTHETIC_RUNNER_UNAVAILABLE');
  });
  const handler = createRunnerHandler({
    key,
    toolchainDigest: 'a'.repeat(64),
    execute,
  });
  const runner = {
    endpoint: 'https://runner.synthetic.test/v1/execute',
    key,
    toolchainDigest: 'a'.repeat(64),
    fetch: (url: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(url, init)),
  };
  const snapshot = {
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: 'synthetic',
    },
    catalog: { revision: 'synthetic', products: [] as PublicProduct[] },
    capabilities: ['navigation', 'catalog.read'] as Array<
      'navigation' | 'catalog.read'
    >,
  };
  let bootstrapCount = 0;
  let useOwnerBootstrap = false;
  const currentBootstrap: typeof loadOwnerPreviewBootstrap = (
    ctx,
    manifest,
    routeId
  ) =>
    useOwnerBootstrap
      ? loadOwnerPreviewBootstrap(ctx, manifest, routeId)
      : Promise.resolve(snapshot);
  const bootstrap: typeof loadOwnerPreviewBootstrap = (
    ctx,
    manifest,
    routeId
  ) => {
    bootstrapCount++;
    if (useLocalRunner && bootstrapCount === 2)
      return Promise.reject(Error('SYNTHETIC_PERFORMANCE_DATA_UNAVAILABLE'));
    return currentBootstrap(ctx, manifest, routeId);
  };
  const pool = useLocalRunner ? await setupVerifierPool(f) : undefined;
  try {
    const verification = pool
      ? await setupBuildVerification({
          f,
          pool,
          key: new Uint8Array(32).fill(3),
          verify: createIndependentBuildVerifier({
            execute: createRunnerExecutor(runner),
            bootstrap: currentBootstrap,
            canonicalBase: async () => 'https://synthetic.synthetic.test',
            previewOrigin: 'https://builder.synthetic.test',
            executionOrigin: 'https://output.synthetic-output.test',
            record: await createVerifierBuildRecorder(pool),
          }),
          capture: await createVerifierCaptureWorker({
            pool,
            hostOrigin: 'https://synthetic.synthetic.test',
            previewOrigin: 'https://builder.synthetic.test',
            bootstrap: currentBootstrap,
            runner,
          }),
          previewOrigin: 'https://builder.synthetic.test',
        })
      : undefined;
    return {
      useLocalRunner,
      enableOwnerBootstrap() {
        useOwnerBootstrap = true;
      },
      setCatalogProduct(product: PublicProduct) {
        snapshot.catalog.products = [product];
      },
      execute,
      runner,
      bootstrap,
      build: {
        key: new Uint8Array(32).fill(2),
        toolchainDigest: 'a'.repeat(64),
        transient: createTransientOutputStore(),
        recordVerifiedEvidence: verification?.client ?? vi.fn(),
      },
      ...(verification
        ? { remoteCapture: verification.capture }
        : { recordCapture: vi.fn() }),
      close: async () => {
        try {
          await verification?.close();
        } finally {
          await pool?.end();
        }
      },
    };
  } catch (error) {
    await pool?.end();
    throw error;
  }
}
