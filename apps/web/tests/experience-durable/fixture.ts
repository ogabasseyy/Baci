import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sourceDigest } from '@baci/shared/experience';
import { createClient } from '@supabase/supabase-js';
import { startLocalPrerenderStorefront } from '../../src/lib/experience/local-prerender-storefront';
import { createDurablePrerenderArtifacts } from '../../tools/experience-runner/durable-prerender-artifacts';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { unpackPrerenderBuild } from '../../tools/experience-runner/prerender-artifacts';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';
import { prepareAnalyticsFixture } from '../experience-commerce/analytics-fixture';
import { createCommerceEngineFixture } from '../experience-commerce/cart-engine-fixture';
import { prepareCommerceCatalog } from '../experience-commerce/catalog-fixture';
import { startCommerceDataApi } from '../experience-commerce/data-api';
import { seedFixtureOutput } from '../experience-commerce/seed-output';
import { storefrontFixture } from '../experience-commerce/storefront-fixture';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function durableStorefrontFixture(
  directory: string,
  hostOrigin = 'http://127.0.0.1:43174',
  port = 0
) {
  const f = await createCommerceEngineFixture();
  let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
  let delivery:
    | Awaited<ReturnType<typeof startLocalPrerenderStorefront>>
    | undefined;
  try {
    const ids = await prepareCommerceCatalog(f);
    await prepareAnalyticsFixture(f);
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261025220000_experience_public_prerender_binding.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const manifest = storefrontFixture();
    const compiled = unpackPrerenderBuild(
      (
        await runLocalQualification(
          'prerender-build',
          packPrivateBuild(manifest, hostOrigin)
        )
      ).output
    );
    await seedFixtureOutput(f, ids.merchant, {
      manifest,
      compiled: compiled.client,
    });
    const build = (
      await f.pool.query(
        'SELECT b.id,b.job_id FROM experience_builds b WHERE b.merchant_id=$1',
        [ids.merchant]
      )
    ).rows[0] as { id: string; job_id: string } | undefined;
    if (!build) throw Error('Missing synthetic build');
    const source = sourceDigest(manifest);
    await f.pool.query(
      'UPDATE experience_artifacts SET source_digest=$1 WHERE merchant_id=$2',
      [source, ids.merchant]
    );
    await f.pool.query(
      'UPDATE experience_jobs SET source_digest=$1 WHERE id=$2',
      [source, build.job_id]
    );
    await f.pool.query(
      'UPDATE experience_builds SET build_digest=$1 WHERE id=$2',
      [compiled.client.digest, build.id]
    );
    await f.pool.query(
      'UPDATE experience_evidence SET build_digest=$1,host_origin=$2 WHERE job_id=$3',
      [compiled.client.digest, hostOrigin, build.job_id]
    );
    for (const [path, bytes] of [
      ['app.js', compiled.client.javascript],
      ['app.css', compiled.client.css],
    ])
      await f.pool.query(
        'UPDATE experience_build_files SET bytes=$1,digest=$2 WHERE build_id=$3 AND path=$4',
        [Buffer.from(bytes), hash(bytes), build.id, path]
      );
    const binding = {
      merchantId: ids.merchant,
      buildId: build.id,
      buildDigest: compiled.client.digest,
      sourceDigest: source,
    };
    createDurablePrerenderArtifacts(directory).retain({
      ...binding,
      renderer: compiled.renderer,
    });
    api = await startCommerceDataApi(f);
    const client = createClient(api.url, api.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let withdrawDuringRender = false;
    let renderCount = 0;
    delivery = await startLocalPrerenderStorefront({
      client,
      artifactDirectory: directory,
      hostOrigin,
      port,
      canonicalBase: (slug) => `${hostOrigin}/${slug}`,
      catalogImages: new Map([
        [
          '33333333-3333-4333-8333-333333333333',
          {
            assetId: 'synthetic-device-image',
            alt: 'Synthetic blue QA device',
          },
        ],
      ]),
      execute: async (kind, input) => {
        renderCount++;
        const result = await runLocalQualification(kind, input);
        if (withdrawDuringRender)
          await f.pool.query(
            'UPDATE merchants SET is_published=false WHERE id=$1',
            [ids.merchant]
          );
        return result;
      },
    });
    await delivery.prepare({ id: ids.merchant, slug: 'qa1' }, [
      '/',
      '/collections/all',
      '/smartphones/synthetic-device',
      '/pages/story',
    ]);
    return {
      renderCount: () => renderCount,
      f,
      api,
      ids,
      delivery,
      client,
      binding,
      manifest,
      withdrawOnRender: () => {
        delivery?.invalidateRenderCache();
        withdrawDuringRender = true;
      },
      async close() {
        await delivery?.gateway.close();
        await api?.close();
        await f.close();
      },
    };
  } catch (error) {
    await delivery?.gateway.close();
    await api?.close();
    await f.close();
    throw error;
  }
}
