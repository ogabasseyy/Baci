import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { lifecycleFixture } from './sql.test-support';

it('fresh approval rejects source, catalog, asset, grant and retained-output drift', async () => {
  const f = await lifecycleFixture();
  try {
    const b = await f.build('negative');
    await f.apply(b, 0);
    const request = () =>
      f.run('experience_request_lifecycle', [
        f.merchantId,
        f.connection,
        1,
        'publish',
        { buildId: b.id, expectedDraftVersion: 1, expectedPublishedVersion: 0 },
        randomUUID(),
      ]);
    const i = await request();
    await f.proof(i.approvalId);
    const deny = () => f.run('experience_confirm_publication', [i.approvalId]);
    await f.pool.query(
      'UPDATE experience_artifacts SET manifest=jsonb_set(manifest,\'{assets}\',\'[{"assetId":"missing"}]\') WHERE id=$1',
      [b.artifact]
    );
    await expect(deny()).rejects.toThrow('ASSET_NOT_RETAINED');
    await f.pool.query(
      "UPDATE experience_artifacts SET manifest=jsonb_set(manifest,'{assets}','[]') WHERE id=$1",
      [b.artifact]
    );
    await f.pool.query(
      "DELETE FROM experience_build_files WHERE build_id=$1 AND path='app.css'",
      [b.id]
    );
    await expect(deny()).rejects.toThrow('OUTPUT_NOT_RETAINED');
    await f.pool.query(
      "INSERT INTO experience_build_files(merchant_id,build_id,path,bytes,digest,mime) VALUES($1,$2,'app.css',''::bytea,encode(sha256(''::bytea),'hex'),'text/css')",
      [f.merchantId, b.id]
    );
    const newer = await f.build('new-source');
    await f.pool.query(
      'INSERT INTO experience_source_heads(merchant_id,artifact_id,version) VALUES($1,$2,1) ON CONFLICT(merchant_id) DO UPDATE SET artifact_id=excluded.artifact_id,version=experience_source_heads.version+1',
      [f.merchantId, newer.artifact]
    );
    await expect(deny()).rejects.toThrow('STALE_SOURCE');
    await f.pool.query(
      'DELETE FROM experience_source_heads WHERE merchant_id=$1',
      [f.merchantId]
    );
    await f.pool.query(
      'INSERT INTO experience_catalog_generations(merchant_id,generation) VALUES($1,2)',
      [f.merchantId]
    );
    await expect(deny()).rejects.toThrow('APPROVAL_MISMATCH');
    await f.pool.query(
      'DELETE FROM experience_catalog_generations WHERE merchant_id=$1',
      [f.merchantId]
    );
    await f.run('disconnect_builder_connection', [f.connection]);
    await expect(deny()).rejects.toThrow('CONNECTION_REVOKED');
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
  } finally {
    await f.close();
  }
});
it('missing legacy fallback requires explicit unpublish effect; replay preserves history and does not restart AI', async () => {
  const f = await lifecycleFixture();
  try {
    const b = await f.build('no-fallback');
    await f.apply(b, 0);
    const revision = (
      await f.pool.query(
        'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
        [f.merchantId]
      )
    ).rows[0].token;
    const payload = {
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
      targetLegacyRevision: revision,
    };
    await expect(
      f.run('experience_request_lifecycle', [
        f.merchantId,
        f.connection,
        1,
        'restore-legacy',
        payload,
        randomUUID(),
      ])
    ).rejects.toThrow('COMPATIBLE_LEGACY_REQUIRED');
    const i = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'unpublish-legacy-draft',
      payload,
      randomUUID(),
    ]);
    await f.proof(i.approvalId);
    const receipt = await f.run('experience_confirm_mode_exit', [i.approvalId]);
    expect(await f.run('experience_confirm_mode_exit', [i.approvalId])).toEqual(
      receipt
    );
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_draft_heads'))
        .rows[0].count
    ).toBe('0');
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_builds')).rows[0]
        .count
    ).toBe('1');
    expect(
      (
        await f.pool.query('SELECT is_published FROM merchants WHERE id=$1', [
          f.merchantId,
        ])
      ).rows[0].is_published
    ).toBe(false);
    await expect(
      f.run('experience_begin_legacy_execution', [f.merchantId])
    ).rejects.toThrow('LEGACY_AI_RESUME_REQUIRED');
  } finally {
    await f.close();
  }
});
it('rollback rejects pruned outputs and incompatible retained policy rather than restoring source', async () => {
  const f = await lifecycleFixture();
  try {
    const first = await f.build('retained-first');
    await f.apply(first, 0);
    const request = (
      action: string,
      buildId: string,
      draft: number,
      published: number
    ) =>
      f.run('experience_request_lifecycle', [
        f.merchantId,
        f.connection,
        1,
        action,
        {
          buildId,
          expectedDraftVersion: draft,
          expectedPublishedVersion: published,
        },
        randomUUID(),
      ]);
    const initial = await request('publish', first.id, 1, 0);
    await f.proof(initial.approvalId);
    await f.run('experience_confirm_publication', [initial.approvalId]);
    const second = await f.build('retained-second');
    await f.apply(second, 1);
    const next = await request('publish', second.id, 2, 1);
    await f.proof(next.approvalId);
    await f.run('experience_confirm_publication', [next.approvalId]);
    await f.pool.query(
      "DELETE FROM experience_build_files WHERE build_id=$1 AND path='app.css'",
      [first.id]
    );
    await expect(request('rollback', first.id, 2, 2)).rejects.toThrow(
      'OUTPUT_NOT_RETAINED'
    );
    await f.pool.query(
      "INSERT INTO experience_build_files(merchant_id,build_id,path,bytes,digest,mime) VALUES($1,$2,'app.css',''::bytea,encode(sha256(''::bytea),'hex'),'text/css')",
      [f.merchantId, first.id]
    );
    await f.pool.query(
      "UPDATE experience_artifacts SET manifest=jsonb_set(manifest,'{runtime}','\"unsupported/v2\"') WHERE id=$1",
      [first.artifact]
    );
    await expect(request('rollback', first.id, 2, 2)).rejects.toThrow(
      'INCOMPATIBLE_POLICY'
    );
    expect(
      (
        await f.pool.query(
          'SELECT build_id FROM experience_published_heads WHERE merchant_id=$1',
          [f.merchantId]
        )
      ).rows[0].build_id
    ).toBe(second.id);
  } finally {
    await f.close();
  }
});
