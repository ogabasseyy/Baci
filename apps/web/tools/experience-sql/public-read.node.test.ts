import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { experienceSqlFixture } from './fixture.ts';

test('public read projection exposes only a current approved verified build and never private source/draft', async () => {
  const f = await experienceSqlFixture();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024124000_experience_public_read_projection.sql',
      '20261103203000_experience_public_manifest_order.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const definition = (
      await f.pool.query(
        "SELECT pg_get_functiondef('public.experience_public_manifest(text)'::regprocedure) value"
      )
    ).rows[0].value;
    assert.equal(
      (definition.match(/ORDER BY ordinal/gi) ?? []).length,
      3,
      'each projected array must explicitly preserve authored order'
    );
    const m = randomUUID();
    const a = randomUUID();
    const j = randomUUID();
    const b = randomUUID();
    const approval = randomUUID();
    const nonce = randomUUID();
    const digest = 'a'.repeat(64);
    await f.pool.query(
      "INSERT INTO merchants(id,slug,is_published) VALUES($1,'synthetic-qa',true)",
      [m]
    );
    await f.pool.query(
      'INSERT INTO experience_artifacts(id,merchant_id,source_digest,manifest) VALUES($1,$2,$3,$4)',
      [
        a,
        m,
        digest,
        JSON.stringify({
          routes: [
            { path: '/z', view: 'editorial' },
            { path: '/', view: 'home', secret: 'PRIVATE_ROUTE_SENTINEL' },
          ],
          capabilities: ['navigation', 'catalog.read'],
          assets: [
            { assetId: 'z', alt: 'Z' },
            { assetId: 'a', alt: 'A' },
          ],
          files: [{ content: 'PRIVATE_SOURCE_SENTINEL' }],
        }),
      ]
    );
    await f.pool.query(
      "INSERT INTO experience_jobs(id,merchant_id,artifact_id,retry_key,source_digest,attempt_nonce,status) VALUES($1,$2,$3,$4,$5,$6,'finalized')",
      [j, m, a, randomUUID(), digest, nonce]
    );
    await f.pool.query(
      "INSERT INTO experience_builds(id,merchant_id,job_id,build_digest,output_manifest) VALUES($1,$2,$3,$4,'[]')",
      [b, m, j, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_approvals(id,merchant_id,build_id,effect_digest) VALUES($1,$2,$3,$4)',
      [approval, m, b, digest]
    );
    await f.pool.query(
      'INSERT INTO experience_published_heads VALUES($1,$2,$3,1)',
      [m, b, approval]
    );
    const bytes = Buffer.from('export{}');
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    await f.pool.query(
      "INSERT INTO experience_build_files VALUES($1,$2,'app.js',$3,$4,'text/javascript')",
      [m, b, fileHash, bytes]
    );
    const read = async (sql: string, args: unknown[] = []) => {
      const c = await f.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE anon');
        const result = await c.query(sql, args);
        await c.query('ROLLBACK');
        return result;
      } finally {
        c.release();
      }
    };
    assert.equal(
      (await read("SELECT experience_public_manifest('synthetic-qa') value"))
        .rows[0].value,
      null
    );
    await f.pool.query(
      'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest) VALUES($1,$2,$3,$4,$4)',
      [m, j, nonce, digest]
    );
    const manifest = (
      await read("SELECT experience_public_manifest('synthetic-qa') value")
    ).rows[0].value;
    assert.equal(manifest.buildDigest, digest);
    assert.deepEqual(
      manifest.routes.map((r: { path: string }) => r.path),
      ['/z', '/']
    );
    assert.deepEqual(
      manifest.assets.map((a: { assetId: string }) => a.assetId),
      ['z', 'a']
    );
    assert.deepEqual(manifest.capabilities, ['navigation', 'catalog.read']);
    assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE_|files|source/);
    assert.equal(
      (
        await read('SELECT experience_public_file($1,$2,$3) value', [
          'synthetic-qa',
          digest,
          'app.js',
        ])
      ).rows[0].value.hex,
      bytes.toString('hex')
    );
    assert.equal(
      (
        await read('SELECT experience_public_file($1,$2,$3) value', [
          'synthetic-qa',
          digest,
          'source.tsx',
        ])
      ).rows[0].value,
      null
    );
    await f.pool.query('UPDATE merchants SET is_published=false WHERE id=$1', [
      m,
    ]);
    assert.equal(
      (
        await read('SELECT experience_public_file($1,$2,$3) value', [
          'synthetic-qa',
          digest,
          'app.js',
        ])
      ).rows[0].value,
      null
    );
  } finally {
    await f.close();
  }
});
