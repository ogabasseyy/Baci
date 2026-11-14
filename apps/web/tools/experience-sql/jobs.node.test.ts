import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture as draftFixture } from './fixture.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('jobs: normal owner queue/finalize, evidence role separated, replay convergence and durable retention', async () => {
  const f = await draftFixture();
  const c = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      ...(process.env.BACI_D_RED
        ? []
        : ['20261024171619_experience_owner_intents.sql']),
      '20261028162326_experience_retry_build_quota.sql',
      '20261103161500_experience_https_build_origins.sql',
      '20261113175836_experience_build_connection_binding.sql',
      '20261113180409_experience_build_bound_lifecycle.sql',
      '20261113181020_experience_finalize_connection_binding.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const a = randomUUID();
    const m = randomUUID();
    const art = randomUUID();
    const retry = randomUUID();
    const digest = hash('source');
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [a]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      m,
      a,
    ]);
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [art, m, digest, {}]
    );
    const queue = () =>
      asActor(c, a, () =>
        c.query('SELECT experience_queue_build($1,null,null,$2,$3) id', [
          m,
          art,
          retry,
        ])
      );
    const job = (await queue()).rows[0].id;
    assert.equal((await queue()).rows[0].id, job);
    const j = (
      await f.pool.query(
        'SELECT attempt_nonce FROM experience_jobs WHERE id=$1',
        [job]
      )
    ).rows[0];
    await asActor(c, a, () =>
      c.query('SELECT experience_claim_build($1,null,null,$2,$3)', [
        m,
        job,
        j.attempt_nonce,
      ])
    );
    const js = 'export{}';
    const build = hash(`${js}\0`);
    const receipt = hash('receipt');
    const files = [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes: Buffer.from(js).toString('hex'),
        digest: hash(js),
      },
      { path: 'app.css', mime: 'text/css', bytes: '', digest: hash('') },
    ];
    const finalize = () =>
      asActor(c, a, () =>
        c.query(
          'SELECT experience_finalize_build($1,null,null,$2,$3,$4,$5,$6,$7,$8,$9) id',
          [
            m,
            job,
            j.attempt_nonce,
            digest,
            build,
            receipt,
            randomUUID(),
            JSON.stringify(files),
            'http://127.0.0.1:4100',
          ]
        )
      );
    await assert.rejects(finalize(), /BUILD_FAILED/);
    await assert.rejects(
      asActor(c, a, () =>
        c.query(
          'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
          [m, job, j.attempt_nonce, build, receipt, 'http://127.0.0.1:4100']
        )
      ),
      /permission denied/
    );
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE baci_experience_verifier');
    await c.query(
      'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
      [m, job, j.attempt_nonce, build, receipt, 'http://127.0.0.1:4100']
    );
    await c.query('COMMIT');
    const b = (await finalize()).rows[0].id;
    assert.equal(
      (
        await f.pool.query(
          'SELECT count(*) FROM experience_draft_heads WHERE merchant_id=$1',
          [m]
        )
      ).rows[0].count,
      '0',
      'finalizing a private candidate must not implicitly approve/apply it'
    );
    assert.equal((await finalize()).rows[0].id, b);
    assert.equal(
      (
        await asActor(c, a, () =>
          c.query(
            'SELECT count(*) FROM experience_build_files WHERE build_id=$1',
            [b]
          )
        )
      ).rows[0].count,
      '2'
    );
    await f.pool.query(
      "UPDATE experience_jobs SET expires_at=now()-interval '25 hours' WHERE id=$1",
      [job]
    );
    assert.equal(
      (
        await asActor(c, a, () =>
          c.query(
            'SELECT count(*) FROM experience_build_files WHERE build_id=$1',
            [b]
          )
        )
      ).rows[0].count,
      '2'
    );
  } finally {
    c.release();
    await f.close();
  }
});

test('jobs: retry preserves the merchant active-job quota and owner authorization', async () => {
  const f = await draftFixture();
  const c = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
      '20261024073533_experience_job_and_draft_lifecycle.sql',
      '20261113175836_experience_build_connection_binding.sql',
      ...(process.env.BACI_D_RED
        ? []
        : ['20261024171619_experience_owner_intents.sql']),
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );

    const owner = randomUUID();
    const outsider = randomUUID();
    const merchant = randomUUID();
    const artifact = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1),($2)', [
      owner,
      outsider,
    ]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      owner,
    ]);
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [artifact, merchant, hash('retry-source'), {}]
    );
    const activeJobs: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = randomUUID();
      await f.pool.query(
        'INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,status) VALUES($1,$2,$3,$4,$5,$6)',
        [id, merchant, artifact, randomUUID(), hash('retry-source'), 'queued']
      );
      activeJobs.push(id);
    }
    const failedJob = randomUUID();
    await f.pool.query(
      'INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,status) VALUES($1,$2,$3,$4,$5,$6)',
      [
        failedJob,
        merchant,
        artifact,
        randomUUID(),
        hash('retry-source'),
        'failed',
      ]
    );
    const retry = (actor: string, job: string) =>
      asActor(c, actor, () =>
        c.query('SELECT experience_retry_build($1,null,null,$2) nonce', [
          merchant,
          job,
        ])
      );

    // Red proof: the previous function let a failed job exceed the active cap.
    assert.match(
      (await retry(owner, failedJob)).rows[0].nonce,
      /^[0-9a-f-]{36}$/i
    );
    await f.pool.query(
      "UPDATE experience_jobs SET status='failed' WHERE id=$1",
      [failedJob]
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261028162326_experience_retry_build_quota.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261113180409_experience_build_bound_lifecycle.sql',
          import.meta.url
        ),
        'utf8'
      )
    );

    // Green proof: the migrated function rejects at four other active jobs.
    await assert.rejects(retry(owner, failedJob), /QUOTA_EXCEEDED/);
    await f.pool.query(
      "UPDATE experience_jobs SET status='failed' WHERE id=$1",
      [activeJobs[0]]
    );
    const nonce = (await retry(owner, failedJob)).rows[0].nonce;
    assert.match(nonce, /^[0-9a-f-]{36}$/i);
    assert.equal(
      (
        await f.pool.query('SELECT status FROM experience_jobs WHERE id=$1', [
          failedJob,
        ])
      ).rows[0].status,
      'queued'
    );

    const unauthorizedJob = randomUUID();
    await f.pool.query(
      'INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,status) VALUES($1,$2,$3,$4,$5,$6)',
      [
        unauthorizedJob,
        merchant,
        artifact,
        randomUUID(),
        hash('retry-source'),
        'failed',
      ]
    );
    await assert.rejects(retry(outsider, unauthorizedJob));
    assert.equal(
      (
        await f.pool.query('SELECT status FROM experience_jobs WHERE id=$1', [
          unauthorizedJob,
        ])
      ).rows[0].status,
      'failed'
    );
  } finally {
    c.release();
    await f.close();
  }
});
