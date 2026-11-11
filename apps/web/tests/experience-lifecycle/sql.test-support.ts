import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { publicationFixture } from '../../tools/builder-auth/publication-test-support';
import { asActor } from '../../tools/experience-sql/fixture';
import { runVerifierTransaction } from './verifier-transaction';
export const hash = (s: string | Uint8Array) =>
  createHash('sha256').update(s).digest('hex');
export async function lifecycleFixture(red = false, local = true) {
  const f = await publicationFixture({ local });
  const c = await (async () => {
    try {
      await f.pool.query(
        'CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz)'
      );
      await f.pool.query(
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS premium_features jsonb DEFAULT '[]'"
      );
      for (const name of [
        '20261024072905_experience_private_foundation.sql',
        '20261024073157_experience_private_uploads.sql',
        '20261024073533_experience_job_and_draft_lifecycle.sql',
        '20261024124000_experience_public_read_projection.sql',
        '20261103203000_experience_public_manifest_order.sql',
        '20261024130000_experience_verified_snapshots.sql',
        '20261024171619_experience_owner_intents.sql',
        '20261024172102_experience_legacy_mode_guards.sql',
        ...(red
          ? []
          : [
              '20261024180212_experience_lifecycle_foundation.sql',
              '20261024180213_experience_lifecycle_transactions.sql',
              '20261024180250_experience_mode_exit_effects.sql',
            ]),
        '20261025060500_experience_upload_manifest_validation.sql',
        '20261028162326_experience_retry_build_quota.sql',
        '20261103161500_experience_https_build_origins.sql',
        '20261103195300_experience_publish_scope_authorization.sql',
      ])
        await f.pool.query(
          readFileSync(
            new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
            'utf8'
          )
        );
      return await f.pool.connect();
    } catch (error) {
      try {
        await f.close();
      } catch {
        console.error('Disposable lifecycle fixture setup cleanup failed');
      }
      throw error;
    }
  })();
  const run = async (name: string, args: unknown[], actor = f.actor) =>
    asActor(c, actor, () =>
      c.query(
        `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`,
        args
      )
    ).then((r) => r.rows[0].result);
  async function build(
    label: string,
    capabilities: string[] = ['catalog.read', 'navigation']
  ) {
    const artifact = randomUUID();
    const job = randomUUID();
    const id = randomUUID();
    const evidence = randomUUID();
    const nonce = randomUUID();
    const js = `export const label=${JSON.stringify(label)};`;
    const digest = hash(`${js}\0`);
    const manifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      routes: [
        { path: '/', view: 'home' },
        { path: '/collections/all', view: 'collection' },
        { path: '/products/[productSlug]', view: 'product' },
        { path: '/pages/story', view: 'editorial' },
      ],
      assets: [],
      capabilities,
    };
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [artifact, f.merchantId, hash(label), manifest]
    );
    await f.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), hash(label), nonce]
    );
    await f.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','http://127.0.0.1:43174')",
      [id, f.merchantId, job, digest]
    );
    await f.pool.query(
      "INSERT INTO experience_evidence(id,merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6,'http://127.0.0.1:43174')",
      [evidence, f.merchantId, job, nonce, digest, hash('independent-build')]
    );
    for (const [path, bytes, mime] of [
      ['app.js', js, 'text/javascript'],
      ['app.css', '', 'text/css'],
    ])
      await f.pool.query(
        'INSERT INTO experience_build_files(merchant_id,build_id,path,bytes,digest,mime) VALUES($1,$2,$3,$4,$5,$6)',
        [f.merchantId, id, path, Buffer.from(bytes), hash(bytes), mime]
      );
    return { id, evidence, artifact, digest };
  }
  async function proof(
    intentId: string,
    kind = 'render',
    receiptId: string | null = null
  ) {
    const i = (
      await f.pool.query(
        'SELECT effect_digest FROM experience_authorization.lifecycle_intents WHERE id=$1',
        [intentId]
      )
    ).rows[0];
    await runVerifierTransaction(c, async () => {
      await c.query(
        "INSERT INTO experience_authorization.lifecycle_checks(intent_id,receipt_id,kind,effect_digest,marker_digest,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '4 minutes')",
        [
          intentId,
          receiptId,
          kind,
          i.effect_digest,
          hash('parent+frame+routes+assets'),
        ]
      );
    });
  }

  async function apply(b: { id: string; evidence: string }, expected: number) {
    const intent = await run('experience_request_draft_apply', [
      f.merchantId,
      f.connection,
      1,
      b.id,
      b.evidence,
      expected,
      randomUUID(),
    ]);
    await runVerifierTransaction(c, async () => {
      await c.query(
        "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '4 minutes')",
        [intent.approvalId, intent.effectDigest, hash('independent-render')]
      );
    });
    return run('experience_confirm_draft_apply', [intent.approvalId]);
  }
  return {
    ...f,
    legacyRun: f.run,
    legacyProof: f.proof,
    c,
    run,
    build,
    apply,
    proof,
    close: async () => {
      c.release();
      await f.close();
    },
  };
}
