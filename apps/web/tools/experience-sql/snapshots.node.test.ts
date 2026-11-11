import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experienceSqlFixture } from './fixture.ts';

test('only the restricted verifier can write evidence; anonymous snapshots require the exact current approved head', async () => {
  const f = await experienceSqlFixture();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024124000_experience_public_read_projection.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    await f.pool.query(
      'CREATE ROLE baci_experience_verifier NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;GRANT USAGE ON SCHEMA public TO baci_experience_verifier;'
    );
    await f.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20261024130000_experience_verified_snapshots.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    const merchant = randomUUID();
    const artifact = randomUUID();
    const job = randomUUID();
    const build = randomUUID();
    const nonce = randomUUID();
    const approval = randomUUID();
    const digest = 'a'.repeat(64);
    const key = 'b'.repeat(64);
    const id = randomUUID();
    await f.pool.query(
      "INSERT INTO merchants(id,slug,is_published) VALUES($1,'synthetic-snapshot',true)",
      [merchant]
    );
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,\'{"routes":[],"capabilities":[],"assets":[]}\')',
      [artifact, merchant, digest]
    );
    await f.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [job, merchant, artifact, randomUUID(), digest, nonce]
    );
    await f.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest) VALUES($1,$2,$3,$4,'[]')",
      [build, merchant, job, digest]
    );
    const insert =
      'INSERT INTO experience_snapshots(id,merchant_id,build_id,build_digest,key_digest,snapshot_key,catalog_revision,consumes_catalog,nodes,evidence_digest,evidence_bytes) VALUES($1,$2,$3,$4,$5,$6,\'current\',true,\'[{"tag":"h1","children":[{"text":"Public story"}]}]\',$5,\'\\x0102\')';
    const args = [
      id,
      merchant,
      build,
      digest,
      key,
      JSON.stringify({
        build: digest,
        assets: key,
        catalog: 'current',
        path: '/',
      }),
    ];
    const asRole = async (
      role: string,
      sql: string,
      values: unknown[] = []
    ) => {
      const c = await f.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${role}`);
        const r = await c.query(sql, values);
        await c.query('COMMIT');
        return r;
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      } finally {
        c.release();
      }
    };
    await assert.rejects(
      asRole('authenticated', insert, args),
      /permission denied/
    );
    await assert.rejects(
      asRole('anon', 'SELECT nodes FROM experience_snapshots'),
      /permission denied/
    );
    await asRole('baci_experience_verifier', insert, args);
    await assert.rejects(
      asRole(
        'baci_experience_verifier',
        'SELECT nodes FROM experience_snapshots'
      ),
      /permission denied/
    );
    const read = () =>
      asRole('anon', 'SELECT experience_public_snapshot($1,$2,$3) value', [
        'synthetic-snapshot',
        digest,
        key,
      ]);
    assert.equal((await read()).rows[0].value, null);
    await f.pool.query(
      'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest) VALUES($1,$2,$3,$4,$4)',
      [merchant, job, nonce, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
      [approval, merchant, build, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_published_heads VALUES($1,$2,$3,1)',
      [merchant, build, approval]
    );
    assert.equal(
      (await read()).rows[0].value.nodes[0].children[0].text,
      'Public story'
    );
    await f.pool.query('UPDATE merchants SET is_published=false WHERE id=$1', [
      merchant,
    ]);
    assert.equal((await read()).rows[0].value, null);
  } finally {
    await f.close();
  }
});
