import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ anonymous: undefined as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: (...args: Parameters<typeof actual.createClient>) =>
      args[0] === 'https://fixture.supabase.co'
        ? state.anonymous
        : actual.createClient(...args),
  };
});
vi.mock('@/lib/experience/canonical-domain', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/experience/canonical-domain')>();
  return {
    ...actual,
    resolveCanonicalBase: async () => 'https://synthetic.example.com',
  };
});
vi.mock('./../../tools/experience-verifier/public-output-fetch', () => ({
  fetchPublicOutput: async () => [],
}));
vi.mock('./../../tools/experience-verifier/public-page-fetch', () => ({
  fetchPublicPages: async () => [],
}));
vi.mock('./../../tools/experience-verifier/public-verification-frame', () => ({
  fetchPublicFrames: async () => [],
}));
vi.mock(
  './../../tools/experience-verifier/public-verification-framework-assets',
  () => ({
    fetchFrameworkAssets: async () => [],
  })
);
vi.mock('./../../tools/experience-verifier/public-verification-plan', () => ({
  derivePublicVerificationPlan: async (binding: Record<string, unknown>) => ({
    ...binding,
    product: {
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'device',
      path: '/products/device',
    },
    routes: [
      {
        path: '/',
        canonical: 'https://synthetic.example.com/',
        title: 'Synthetic',
      },
    ],
    journeySteps: [
      { action: 'navigate', path: '/' },
      { action: 'product', path: '/products/device' },
      { action: 'cart-add', path: '/products/device' },
      { action: 'cart-read', path: '/cart' },
      { action: 'checkout-review', path: '/checkout' },
    ],
  }),
}));

import { createPublicVerificationCoordinator } from '../../tools/experience-verifier/public-verification-coordinator';
import { createPublicVerificationHandler } from '../../tools/experience-verifier/public-verification-handler';
import { experienceDataFixture } from './data-fixture.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
it('binds the synthetic owner receipt and anonymous published bytes to a restricted proof', async () => {
  const f = await experienceDataFixture();
  const pool = await setupVerifierPool(f);
  try {
    state.anonymous = f.anonymous;
    await f.db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261112003000_experience_public_proof.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const headApproval = randomUUID();
    const intent = randomUUID();
    const receipt = randomUUID();
    const nonce = randomUUID();
    const script = 'synthetic script';
    const css = 'synthetic css';
    const buildDigest = hash(`${script}\0${css}`);
    const effect = hash('synthetic effect');
    const manifest = {
      routes: [
        { path: '/', view: 'home' },
        { path: '/products/[handle]', view: 'product' },
      ],
      assets: [],
      capabilities: ['navigation', 'catalog.read'],
    };
    await f.db.pool.query(
      "UPDATE merchants SET slug='synthetic',is_published=true WHERE id=$1",
      [f.merchantId]
    );
    await f.db.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [artifact, f.merchantId, hash('source'), manifest]
    );
    await f.db.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), hash('source'), nonce]
    );
    await f.db.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','https://synthetic.example.com')",
      [build, f.merchantId, job, buildDigest]
    );
    for (const [path, body, mime] of [
      ['app.js', script, 'text/javascript'],
      ['app.css', css, 'text/css'],
    ])
      await f.db.pool.query(
        'INSERT INTO experience_build_files(merchant_id,build_id,path,digest,bytes,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [f.merchantId, build, path, hash(body), Buffer.from(body), mime]
      );
    await f.db.pool.query(
      "INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,'synthetic','https://synthetic.example.com')",
      [f.merchantId, job, nonce, buildDigest]
    );
    await f.db.pool.query(
      'INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
      [headApproval, f.merchantId, build, effect]
    );
    await f.db.pool.query(
      'INSERT INTO experience_published_heads(merchant_id,build_id,approval_id,publication_revision) VALUES($1,$2,$3,1)',
      [f.merchantId, build, headApproval]
    );
    const token = randomUUID();
    await f.db.pool.query(
      'INSERT INTO builder_published_revisions(merchant_id,token) VALUES($1,$2) ON CONFLICT(merchant_id) DO UPDATE SET token=$2',
      [f.merchantId, token]
    );
    const storedToken = (
      await f.db.pool.query(
        'SELECT token FROM builder_published_revisions WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0].token;
    await f.db.pool.query(
      "INSERT INTO experience_authorization.lifecycle_intents(id,merchant_id,actor_user_id,retry_key,action,payload,effect_digest,snapshot) VALUES($1,$2,$3,$4,'publish','{}',$5,'{}')",
      [intent, f.merchantId, f.actorId, randomUUID(), effect]
    );
    await f.db.pool.query(
      "INSERT INTO experience_authorization.lifecycle_receipts(id,intent_id,merchant_id,build_id,publication_revision,published_token,action) VALUES($1,$2,$3,$4,1,$5,'publish')",
      [receipt, intent, f.merchantId, build, storedToken]
    );
    const observation: Parameters<
      typeof createPublicVerificationCoordinator
    >[0]['observe'] = (binding, _output, _pages, plan) =>
      Promise.resolve({
        parentBuild: binding.buildDigest,
        frameBuild: binding.buildDigest,
        scriptDigest: binding.scriptDigest,
        styleDigest: binding.styleDigest,
        assets: binding.assets,
        routes: plan.routes.map((route) => ({ ...route, status: 200 })),
        journey: {
          steps: plan.journeySteps.map((step) => ({
            ...step,
            evidenceDigest: effect,
          })),
          orderRequests: 0,
          paymentRequests: 0,
        },
        evidenceDigest: effect,
      });
    const observe = vi.fn(observation);
    const config = {
      supabase: {
        url: 'https://fixture.supabase.co',
        anonKey: 'sb_publishable_synthetic123',
      },
      pool,
      rootDomain: 'example.com',
      executionOrigin: 'https://runtime.other-example.com',
      observe,
    };
    const wrongOwner = await createPublicVerificationCoordinator({
      ...config,
      owner: f.other.supabase,
    });
    await expect(wrongOwner(intent)).rejects.toThrow();
    expect(observe).not.toHaveBeenCalled();
    const verify = await createPublicVerificationCoordinator({
      ...config,
      owner: f.owner.supabase,
    });
    observe.mockImplementationOnce(async (...args) => {
      await f.db.pool.query(
        'UPDATE experience_published_heads SET publication_revision=2 WHERE merchant_id=$1',
        [f.merchantId]
      );
      return observation(...args);
    });
    await expect(verify(intent)).rejects.toThrow();
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*) FROM experience_authorization.lifecycle_checks WHERE kind='public' AND receipt_id=$1",
          [receipt]
        )
      ).rows[0].count
    ).toBe('0');
    await f.db.pool.query(
      'UPDATE experience_published_heads SET publication_revision=1 WHERE merchant_id=$1',
      [f.merchantId]
    );
    const handlerKey = Buffer.alloc(32, 7);
    const handler = createPublicVerificationHandler({
      key: handlerKey,
      consumeNonce: async () => true,
      resolveUserClient: async (token) =>
        token === f.owner.accessToken ? f.owner.supabase : f.other.supabase,
      verify: async (owner, id) => {
        const scoped = await createPublicVerificationCoordinator({
          ...config,
          owner,
        });
        await scoped(id);
      },
    });
    const call = (accessToken: string) => {
      const body = JSON.stringify({
        version: 1,
        nonce: 'a'.repeat(64),
        expiresAt: Date.now() + 30000,
        accessToken,
        approvalId: intent,
      });
      const signature = createHmac('sha256', handlerKey)
        .update(`verifier-public/v1\n${body}`)
        .digest('hex');
      return handler(
        new Request('https://verifier.baci-internal.invalid/v1/public', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-baci-verifier-signature': signature,
          },
          body,
        })
      );
    };
    expect((await call(f.other.accessToken)).status).toBe(403);
    expect((await call(f.owner.accessToken)).status).toBe(204);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*) FROM experience_authorization.lifecycle_checks WHERE kind='public' AND receipt_id=$1",
          [receipt]
        )
      ).rows[0].count
    ).toBe('1');
    await f.db.pool.query(
      'UPDATE experience_published_heads SET publication_revision=2 WHERE merchant_id=$1',
      [f.merchantId]
    );
    await expect(verify(intent)).rejects.toThrow();
  } finally {
    state.anonymous = undefined;
    await pool.end();
    await f.close();
  }
}, 30000);
