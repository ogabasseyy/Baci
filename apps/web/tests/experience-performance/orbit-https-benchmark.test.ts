import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { measureCandidatePerformance } from '../../src/lib/experience/candidate-performance-measurement';
import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { createPublicExperienceRuntime } from '../../src/lib/experience/public-runtime';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';
import { createCommerceEngineFixture } from '../experience-commerce/cart-engine-fixture';
import { prepareCommerceCatalog } from '../experience-commerce/catalog-fixture';
import { compileStorefrontFixture } from '../experience-commerce/compile-storefront';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import { seedFixtureOutput } from '../experience-commerce/seed-output';

// Explicit opt-in: never add 24 expensive browser samples to ordinary local tests.
it.skipIf(process.env.BACI_RUN_ORBIT_HTTPS_BENCHMARK !== '1')(
  'benchmarks Orbit HTTPS route families at mobile and desktop widths under the normal load gate',
  async (context) => {
    const directory = resolve(
      '../../docs/connectors/evidence/orbit-https-benchmark-20261103'
    );
    mkdirSync(directory, { recursive: true });
    const before = { load1: loadavg()[0], cpuCount: cpus().length };
    const save = (value: unknown) =>
      writeFileSync(
        resolve(directory, 'result.json'),
        `${JSON.stringify(value, null, 2)}\n`
      );
    if (before.load1 > before.cpuCount * 0.8) {
      save({
        status: 'blocked-host-load',
        before,
        samplesExecuted: 0,
        cwvQualified: false,
        releaseQualified: false,
      });
      context.skip();
      return;
    }
    const fixture = await createCommerceEngineFixture();
    let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
    try {
      const { merchant } = await prepareCommerceCatalog(fixture);
      const { image } = await seedFixtureOutput(
        fixture,
        merchant,
        await compileStorefrontFixture()
      );
      api = await startCommerceDataApi(fixture);
      // Resolve public data through the retained fixture head's exact trusted host,
      // then compile the same source for the synthetic HTTPS measurement host.
      const runtime = createPublicExperienceRuntime({
        client: createClient(api.url, api.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        runtimeBase: 'http://127.0.0.1:43175',
        canonicalBase: (slug) => `http://127.0.0.1:43174/${slug}`,
      });
      const { manifest } = JSON.parse(
        readFileSync(
          resolve(
            '../../.superpowers/sdd/2026-10-23-full-code-experiences/c-compiled-fixture.json'
          ),
          'utf8'
        )
      ) as { manifest: ExperienceManifest };
      const hostOrigin = 'https://orbit.synthetic.test';
      const result = await runLocalQualification(
        'prerender-build',
        packPrivateBuild(manifest, hostOrigin, 'production')
      );
      const bundles = result.output as { client: unknown; renderer: unknown };
      const client = verifyCompiledCandidate(bundles.client);
      const renderer = verifyCompiledCandidate(bundles.renderer);
      const paths = {
        home: '/',
        collection: '/collections/all',
        product: '/phones/synthetic-device',
        editorial: '/pages/story',
      } as const;
      const measured = await measureCandidatePerformance({
        execute: runLocalQualification,
        manifest,
        candidate: { ...client, hostOrigin },
        renderer: { ...renderer, hostOrigin },
        rendererKind: 'prerender',
        assets: [
          {
            assetId: 'synthetic-device-image',
            mime: 'image/png',
            bytesBase64: image.toString('base64'),
            digest: digestBytes(image),
          },
        ],
        sourceDigest: sourceDigest(manifest),
        bootstrap: async (view) => {
          if (!(view in paths)) throw Error('UNSUPPORTED_BENCHMARK_VIEW');
          const resolved = await runtime.resolveBoundary(
            { id: merchant, slug: 'qa1' },
            paths[view as keyof typeof paths]
          );
          if (!resolved) throw Error('MISSING_SYNTHETIC_ROUTE');
          return resolved.bootstrap;
        },
        // Deliberately retain the standard host-load and worker contamination gates.
      });
      const orderCount = (
        await fixture.pool.query('SELECT count(*) FROM orders')
      ).rows[0].count;
      save({
        before,
        after: { load1: loadavg()[0], cpuCount: cpus().length },
        normalAnonymousRls: true,
        orderCount,
        ...measured,
      });
      expect(orderCount).toBe('0');
      expect(measured.status).toBe('measured');
      expect(measured.report?.samples).toHaveLength(24);
      for (const sample of measured.report?.samples ?? []) {
        expect(sample.diagnostics?.transport).toBe('https-loopback-tls');
        expect(sample.diagnostics?.tlsConnections).toBeGreaterThanOrEqual(2);
        expect(sample.consoleErrors).toBe(0);
        expect(sample.contentVisible).toBe(true);
        expect(sample.imagesDecoded).toBe(true);
      }
      expect(measured.report?.cwvQualified).toBe(false);
      expect(measured.report?.releaseQualified).toBe(false);
    } finally {
      await api?.close();
      await fixture.close();
    }
  },
  240000
);
