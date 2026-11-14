import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { experienceDataFixture } from './data-fixture.test-support';

vi.mock('server-only', () => ({}));

it('reports expired unfinished jobs using database time under owner RLS', async () => {
  const f = await experienceDataFixture();
  try {
    const artifact = randomUUID();
    const job = randomUUID();
    await f.db.pool.query(
      "INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,repeat('a',64),'{}')",
      [artifact, f.merchantId]
    );
    await f.db.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,status,expires_at) VALUES($1,$2,$3,$4,repeat('a',64),'queued',clock_timestamp()-interval '1 second')",
      [job, f.merchantId, artifact, randomUUID()]
    );
    const args = { p_merchant: f.merchantId, p_job: job };
    const result = await f.owner.supabase.rpc(
      'experience_read_build_operation',
      args
    );
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: job, status: 'expired' });
    await f.db.pool.query(
      "UPDATE experience_jobs SET status='running' WHERE id=$1",
      [job]
    );
    expect(
      (await f.owner.supabase.rpc('experience_read_build_operation', args)).data
    ).toMatchObject({ status: 'expired' });
    await f.db.pool.query(
      "UPDATE experience_jobs SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [job]
    );
    expect(
      (await f.owner.supabase.rpc('experience_read_build_operation', args)).data
    ).toMatchObject({ status: 'running' });
    const other = await f.other.supabase.rpc(
      'experience_read_build_operation',
      args
    );
    expect(other.error).toBeNull();
    expect(other.data).toBeNull();
    const anonymous = await f.anonymous.rpc(
      'experience_read_build_operation',
      args
    );
    expect(anonymous.error).not.toBeNull();
    await f.db.pool.query(
      "UPDATE experience_jobs SET status='failed' WHERE id=$1",
      [job]
    );
    expect(
      (await f.owner.supabase.rpc('experience_read_build_operation', args)).data
    ).toMatchObject({ status: 'failed' });
    const build = randomUUID();
    await f.db.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest,host_origin) VALUES($1,$2,$3,repeat('b',64),'[]','https://synthetic.example.test')",
      [build, f.merchantId, job]
    );
    await f.db.pool.query(
      "UPDATE experience_jobs SET status='finalized',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job]
    );
    expect(
      (await f.owner.supabase.rpc('experience_read_build_operation', args)).data
    ).toMatchObject({
      status: 'finalized',
      buildId: build,
      buildDigest: 'b'.repeat(64),
    });
  } finally {
    await f.close();
  }
});
