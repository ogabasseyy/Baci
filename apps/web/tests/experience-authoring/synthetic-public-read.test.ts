import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createPublicOutputReader } from '@/lib/experience/public-output-reader';
import { createPublicExperienceRuntime } from '@/lib/experience/public-runtime';
import { startPublishedGateway } from '../../tools/experience-runner/published-gateway';
import {
  installCombinedCartFixture,
  installCombinedCatalogFixture,
  installCombinedPublicCatalogFixture,
} from './combined-cart-fixture.test-support';
import { experienceDataFixture } from './data-fixture.test-support';
import { seedSyntheticPublicRead } from './synthetic-public-read.test-support';

vi.mock('server-only', () => ({}));

it('seeds only a finalized evidenced build in the disposable public-read fixture', async () => {
  const f = await experienceDataFixture();
  let gateway: Awaited<ReturnType<typeof startPublishedGateway>> | undefined;
  try {
    await installCombinedCartFixture(f);
    await installCombinedCatalogFixture(f);
    await installCombinedPublicCatalogFixture(f);
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const attempt = randomUUID();
    const digest = 'a'.repeat(64);
    await f.db.pool.query(
      "UPDATE merchants SET slug='synthetic-public-read',is_published=false,premium_features='[\"shared_cart\"]' WHERE id=$1",
      [f.merchantId]
    );
    const product = await f.owner.supabase
      .from('products')
      .insert({
        merchant_id: f.merchantId,
        name: 'Synthetic public device',
        slug: 'synthetic-public-device',
        price: 250,
        status: 'active',
        images: [],
      })
      .select('id')
      .single();
    expect(product.error).toBeNull();
    await f.db.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        artifact,
        f.merchantId,
        digest,
        {
          assets: [],
          routes: [{ path: '/', view: 'home' }],
          capabilities: ['catalog.read'],
        },
      ]
    );
    await f.db.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), digest, attempt]
    );
    await f.db.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','https://synthetic.synthetic.test')",
      [build, f.merchantId, job, digest]
    );
    for (const [path, mime, text] of [
      [
        'app.js',
        'text/javascript',
        'document.body.dataset.fixture="synthetic";',
      ],
      ['app.css', 'text/css', 'body{color:black}'],
    ]) {
      const bytes = Buffer.from(text);
      await f.db.pool.query(
        'INSERT INTO experience_build_files(merchant_id,build_id,path,digest,bytes,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [f.merchantId, build, path, digestBytes(bytes), bytes, mime]
      );
    }
    await expect(
      seedSyntheticPublicRead(f, f.merchantId, build)
    ).rejects.toThrow('QUALIFIED_SYNTHETIC_BUILD_REQUIRED');
    expect(
      (
        await f.anonymous.rpc('experience_public_manifest', {
          p_slug: 'synthetic-public-read',
        })
      ).data
    ).toBeNull();
    await f.db.pool.query(
      "INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,'synthetic-test','https://synthetic.synthetic.test')",
      [f.merchantId, job, attempt, digest]
    );
    expect(await seedSyntheticPublicRead(f, f.merchantId, build)).toEqual({
      slug: 'synthetic-public-read',
      digest,
    });
    expect(
      (
        await f.anonymous.rpc('experience_public_manifest', {
          p_slug: 'synthetic-public-read',
        })
      ).data
    ).toMatchObject({ merchantId: f.merchantId, buildDigest: digest });
    gateway = await startPublishedGateway(
      createPublicOutputReader(f.anonymous),
      'https://synthetic.synthetic.test'
    );
    const publicPage = await fetch(
      `${gateway.origin}/published/synthetic-public-read/${digest}/index.html`
    );
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain('src="app.js"');
    const script = await fetch(
      `${gateway.origin}/published/synthetic-public-read/${digest}/app.js`
    );
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('dataset.fixture');
    const runtime = createPublicExperienceRuntime({
      client: f.anonymous,
      runtimeBase: 'https://output.synthetic-output.test',
      canonicalBase: () => 'https://synthetic.synthetic.test',
    });
    const boundary = await runtime.resolveBoundary(
      { id: f.merchantId, slug: 'synthetic-public-read' },
      '/'
    );
    expect(boundary?.bootstrap.catalog.products).toContainEqual(
      expect.objectContaining({
        id: product.data?.id,
        name: 'Synthetic public device',
      })
    );
    const foreign = await f.other.supabase
      .from('experience_builds')
      .select('id')
      .eq('id', build);
    expect(foreign.data).toEqual([]);
  } finally {
    await gateway?.close();
    await f.close();
  }
});
