import { randomUUID } from 'node:crypto';
import type { experienceDataFixture } from './data-fixture.test-support';

/** Seed a public-read projection only inside the disposable local database. */
export async function seedSyntheticPublicRead(
  fixture: Awaited<ReturnType<typeof experienceDataFixture>>,
  merchantId: string,
  buildId: string
) {
  if (!fixture.db.localDatabase?.socketDirectory.startsWith('/var/folders/'))
    throw Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
  const client = await fixture.db.pool.connect();
  try {
    await client.query('BEGIN');
    const build = await client.query(
      `SELECT b.build_digest FROM experience_builds b
       JOIN experience_jobs j ON j.id=b.job_id AND j.merchant_id=b.merchant_id
       JOIN experience_evidence e ON e.job_id=j.id AND e.merchant_id=j.merchant_id AND e.attempt_nonce=j.attempt_nonce AND e.build_digest=b.build_digest
       WHERE b.id=$1 AND b.merchant_id=$2 AND j.status='finalized'`,
      [buildId, merchantId]
    );
    if (build.rowCount !== 1) throw Error('QUALIFIED_SYNTHETIC_BUILD_REQUIRED');
    const approval = randomUUID();
    await client.query(
      "INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,'synthetic-local-only')",
      [approval, merchantId, buildId]
    );
    await client.query(
      'INSERT INTO experience_published_heads(merchant_id,build_id,approval_id,publication_revision) VALUES($1,$2,$3,1)',
      [merchantId, buildId, approval]
    );
    const merchant = await client.query(
      'UPDATE merchants SET is_published=true WHERE id=$1 AND is_published=false RETURNING slug',
      [merchantId]
    );
    if (merchant.rowCount !== 1)
      throw Error('SYNTHETIC_PRIVATE_MERCHANT_REQUIRED');
    await client.query('COMMIT');
    return {
      slug: merchant.rows[0].slug as string,
      digest: build.rows[0].build_digest as string,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
