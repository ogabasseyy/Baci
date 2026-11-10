import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asActor, experienceSqlFixture as draftFixture } from './fixture.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('uploads: duplicate converges, changed/overlapping chunks denied, wrong owner/expiry denied, immutable artifact', async () => {
  const f = await draftFixture();
  const c = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const a = randomUUID();
    const b = randomUUID();
    const m = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1),($2)', [a, b]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      m,
      a,
    ]);
    const manifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: '' }],
      packages: [],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: [],
    };
    const file = { path: 'app.tsx', bytes: 3, digest: hash('abc') };
    const u = await asActor(c, a, () =>
      c.query('SELECT experience_begin_upload($1,null,null,$2) id', [
        m,
        { manifest, files: [file] },
      ])
    );
    const id = u.rows[0].id;
    const chunk = (actor: string, offset: number, content: string) =>
      asActor(c, actor, () =>
        c.query('SELECT experience_write_chunk($1,null,null,$2,$3,$4,$5,$6)', [
          m,
          id,
          'app.tsx',
          offset,
          Buffer.from(content).toString('hex'),
          hash(content),
        ])
      );
    await chunk(a, 0, 'ab');
    await chunk(a, 0, 'ab');
    await assert.rejects(chunk(a, 0, 'zz'), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(chunk(a, 1, 'bc'), /INVALID_REQUEST/);
    await assert.rejects(chunk(b, 2, 'c'), /NOT_FOUND/);
    await chunk(a, 2, 'c');
    const canonical = JSON.stringify({
      ...manifest,
      files: [{ path: 'app.tsx', content: 'abc' }],
    });
    const finalize = (actor: string) =>
      asActor(c, actor, () =>
        c.query('SELECT experience_finalize_upload($1,null,null,$2,$3,$4) id', [
          m,
          id,
          canonical,
          hash(canonical),
        ])
      );
    await assert.rejects(finalize(b), /NOT_FOUND/);
    const art = await finalize(a);
    assert.equal((await finalize(a)).rows[0].id, art.rows[0].id);
    const source = await asActor(c, a, () =>
      c.query(
        'SELECT content FROM experience_source_files WHERE artifact_id=$1',
        [art.rows[0].id]
      )
    );
    assert.equal(source.rows[0].content, 'abc');
    assert.equal(
      (
        await asActor(c, b, () =>
          c.query('SELECT id FROM experience_artifacts')
        )
      ).rowCount,
      0
    );
    await assert.rejects(
      asActor(c, a, () =>
        c.query('UPDATE experience_artifacts SET merchant_id=$1', [
          randomUUID(),
        ])
      ),
      /permission denied/
    );
    await f.pool.query(
      "UPDATE experience_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id]
    );
    await assert.rejects(chunk(a, 2, 'c'), /LAUNCH_EXPIRED/);
  } finally {
    c.release();
    await f.close();
  }
});

test('uploads: rejects missing, null, mistyped and fractional manifest fields before quota accounting', async () => {
  const f = await draftFixture();
  const c = await f.pool.connect();
  try {
    for (const name of [
      '20261024072905_experience_private_foundation.sql',
      '20261024073157_experience_private_uploads.sql',
      '20261025060500_experience_upload_manifest_validation.sql',
    ])
      await f.pool.query(
        readFileSync(
          new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
          'utf8'
        )
      );
    const a = randomUUID();
    const m = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [a]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      m,
      a,
    ]);
    const valid = { path: 'app.tsx', bytes: 3, digest: hash('abc') };
    const malformed: unknown[] = [
      { files: [{ path: valid.path, digest: valid.digest }] },
      {},
      { files: null },
      { files: {} },
      { files: [] },
      { files: [null] },
      { files: [{ ...valid, bytes: null }] },
      { files: [{ ...valid, bytes: '3' }] },
      { files: [{ ...valid, bytes: 1.5 }] },
      { files: [{ ...valid, path: null }] },
      { files: [{ ...valid, digest: 12 }] },
      { files: [{ bytes: 3, digest: valid.digest }] },
      { files: [{ path: valid.path, bytes: 3 }] },
    ];
    for (const manifest of malformed)
      await assert.rejects(
        asActor(c, a, () =>
          c.query('SELECT experience_begin_upload($1,null,null,$2)', [
            m,
            manifest,
          ])
        ),
        /INVALID_REQUEST/
      );
    assert.equal(
      (
        await f.pool.query(
          'SELECT count(*)::integer count FROM experience_uploads'
        )
      ).rows[0].count,
      0
    );
    await asActor(c, a, () =>
      c.query('SELECT experience_begin_upload($1,null,null,$2)', [
        m,
        { files: [valid] },
      ])
    );
  } finally {
    c.release();
    await f.close();
  }
});
