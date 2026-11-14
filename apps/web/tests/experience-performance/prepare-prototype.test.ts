import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ExperienceManifest } from '@baci/shared/experience';
import { sourceDigest } from '@baci/shared/experience';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPublicExperienceRuntime } from '../../src/lib/experience/public-runtime';
import { bundleSource } from '../../tools/experience-runner/bundle-source';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { createCommerceEngineFixture } from '../experience-commerce/cart-engine-fixture';
import { prepareCommerceCatalog } from '../experience-commerce/catalog-fixture';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import { seedFixtureOutput } from '../experience-commerce/seed-output';
import { prerenderDocument } from './prerender-document';

const scratch = new URL(
  '../../../../.superpowers/sdd/2026-10-25-experience-cwv/artifacts/',
  import.meta.url
);
const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
it('prerenders full Orbit routes in gVisor from normal anonymous/RLS public data without orders', async () => {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  try {
    const { merchant } = await prepareCommerceCatalog(f);
    const { image } = await seedFixtureOutput(f, merchant);
    api = await startCommerceDataApi(f);
    const runtime = createPublicExperienceRuntime({
      client: createClient(api.url, api.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      runtimeBase: 'http://127.0.0.1:43175',
      canonicalBase: (slug) => `http://127.0.0.1:43174/${slug}`,
    });
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-compiled-fixture.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as { manifest: ExperienceManifest };
    const server = await bundleSource(fixture.manifest, {
      renderMode: 'prerender',
    });
    const client = await bundleSource(fixture.manifest, {
      renderMode: 'hydrate',
      hostOrigin: 'http://127.0.0.1:43176',
    });
    const baseline = await bundleSource(fixture.manifest, {
      mountComponent: true,
      hostOrigin: 'http://127.0.0.1:43176',
    });
    mkdirSync(scratch, { recursive: true });
    writeFileSync(new URL('app.js', scratch), client.javascript);
    writeFileSync(new URL('app.css', scratch), client.css);
    writeFileSync(new URL('baseline.js', scratch), baseline.javascript);
    writeFileSync(new URL('synthetic-device-image.png', scratch), image);
    const routes = [];
    for (const path of [
      '/',
      '/collections/all',
      '/phones/synthetic-device',
      '/pages/story',
    ]) {
      const data = await runtime.resolveBoundary(
        { id: merchant, slug: 'qa1' },
        path
      );
      expect(data).not.toBeNull();
      if (!data) throw Error('Missing public route');
      // Same synthetic bytes, relative to the independent local frame origin.
      const bootstrap = {
        ...data.bootstrap,
        assets: Object.fromEntries(
          Object.keys(data.bootstrap.assets ?? {}).map((id) => [
            id,
            `/assets/${id}`,
          ])
        ),
      };
      const rendered = await runLocalQualification('prerender', {
        javascript: server.javascript,
        bootstrap,
      }).catch((error: unknown) => {
        if (error && typeof error === 'object') {
          const detail = error as { stdout?: string; stderr?: string };
          console.error('PRERENDER_DIAGNOSTIC', {
            stdoutBytes: Buffer.byteLength(detail.stdout ?? ''),
            phases: detail.stderr,
          });
        }
        throw error;
      });
      const output = rendered.output as { format: string; html: string };
      expect(output.format).toBe('baci-prerender/v1');
      expect(output.html).toContain('orbit');
      expect(output.html).not.toContain('<script');
      const filename =
        path === '/' ? 'index.html' : `${hash(path).slice(0, 16)}.html`;
      const html = prerenderDocument(
        output.html,
        bootstrap,
        client.javascript,
        client.css
      );
      writeFileSync(new URL(filename, scratch), html);
      routes.push({
        path,
        filename,
        htmlDigest: hash(html),
        catalogRevision: bootstrap.catalog.revision,
        jobId: rendered.jobId,
      });
      if (path === '/')
        writeFileSync(
          new URL('bootstrap.json', scratch),
          JSON.stringify(bootstrap)
        );
    }
    expect(
      (await f.pool.query('SELECT count(*) FROM orders')).rows[0].count
    ).toBe('0');
    writeFileSync(
      new URL('receipt.json', scratch),
      JSON.stringify(
        {
          prototypeOnly: true,
          releaseQualified: false,
          coreWebVitalsQualified: false,
          baseMain: execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim(),
          sourceDigest: sourceDigest(fixture.manifest),
          javascriptDigest: hash(client.javascript),
          cssDigest: hash(client.css),
          routes,
          orders: 0,
          aiProviderCalls: 0,
        },
        null,
        2
      )
    );
  } finally {
    await api?.close();
    await f.close();
  }
});
