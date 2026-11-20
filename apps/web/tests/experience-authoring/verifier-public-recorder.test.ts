import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createVerifierPublicRecorder } from '../../tools/experience-verifier/public-recorder';
import { experienceDataFixture } from './data-fixture.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

vi.mock('server-only', () => ({}));

it('records public evidence only for the exact active publication under the restricted verifier role', async () => {
  const f = await experienceDataFixture();
  const pool = await setupVerifierPool(f);
  try {
    await f.db.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261112003000_experience_public_proof.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const actor = (
      await f.db.pool.query(
        'SELECT user_id FROM public.merchants WHERE id=$1',
        [f.merchantId]
      )
    ).rows[0].user_id;
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const approval = randomUUID();
    const intent = randomUUID();
    const receipt = randomUUID();
    const token = randomUUID();
    const digest = 'a'.repeat(64);
    const marker = 'b'.repeat(64);
    await f.db.pool.query(
      'INSERT INTO public.experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        artifact,
        f.merchantId,
        digest,
        { routes: [], assets: [], capabilities: [] },
      ]
    );
    await f.db.pool.query(
      "INSERT INTO public.experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, f.merchantId, artifact, randomUUID(), digest, randomUUID()]
    );
    await f.db.pool.query(
      "INSERT INTO public.experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,$4,'[]','https://shop.synthetic.test')",
      [build, f.merchantId, job, digest]
    );
    await f.db.pool.query(
      'INSERT INTO public.experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
      [approval, f.merchantId, build, digest]
    );
    await f.db.pool.query(
      'INSERT INTO public.experience_published_heads(merchant_id,build_id,approval_id,publication_revision) VALUES($1,$2,$3,1)',
      [f.merchantId, build, approval]
    );
    await f.db.pool.query(
      'UPDATE public.merchants SET is_published=true WHERE id=$1',
      [f.merchantId]
    );
    await f.db.pool.query(
      'INSERT INTO public.builder_published_revisions(merchant_id,token) VALUES($1,$2) ON CONFLICT(merchant_id) DO UPDATE SET token=$2',
      [f.merchantId, token]
    );
    const storedToken = (
      await f.db.pool.query(
        'SELECT token FROM public.builder_published_revisions WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0].token;
    await f.db.pool.query(
      "INSERT INTO experience_authorization.lifecycle_intents(id,merchant_id,actor_user_id,retry_key,action,payload,effect_digest,snapshot) VALUES($1,$2,$3,$4,'publish','{}',$5,'{}')",
      [intent, f.merchantId, actor, randomUUID(), digest]
    );
    await f.db.pool.query(
      "INSERT INTO experience_authorization.lifecycle_receipts(id,intent_id,merchant_id,build_id,publication_revision,published_token,action) VALUES($1,$2,$3,$4,1,$5,'publish')",
      [receipt, intent, f.merchantId, build, storedToken]
    );
    const record = await createVerifierPublicRecorder(pool);
    await expect(
      pool.query(
        "INSERT INTO experience_authorization.lifecycle_checks(intent_id,receipt_id,kind,effect_digest,marker_digest) VALUES($1,$2,'public',$3,$4)",
        [intent, receipt, digest, marker]
      )
    ).rejects.toThrow();
    await pool.query(
      "INSERT INTO experience_authorization.lifecycle_checks(intent_id,kind,effect_digest,marker_digest) VALUES($1,'render',$2,$3)",
      [intent, digest, marker]
    );
    await expect(
      record({
        receiptId: receipt,
        effectDigest: 'c'.repeat(64),
        markerDigest: marker,
      })
    ).rejects.toThrow();
    await record({
      receiptId: receipt,
      effectDigest: digest,
      markerDigest: marker,
    });
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*) FROM experience_authorization.lifecycle_checks WHERE kind='public' AND receipt_id=$1",
          [receipt]
        )
      ).rows[0].count
    ).toBe('1');
    await f.db.pool.query(
      'UPDATE public.experience_published_heads SET publication_revision=2 WHERE merchant_id=$1',
      [f.merchantId]
    );
    await expect(
      record({ receiptId: receipt, effectDigest: digest, markerDigest: marker })
    ).rejects.toThrow();
    const regular = await f.db.pool.connect();
    try {
      await regular.query('SET ROLE authenticated');
      await expect(
        regular.query(
          'SELECT public.experience_record_public_check($1,$2,$3)',
          [receipt, digest, marker]
        )
      ).rejects.toThrow(/permission denied/);
    } finally {
      await regular.query('RESET ROLE');
      regular.release();
    }
  } finally {
    await pool.end();
    await f.close();
  }
}, 30000);
