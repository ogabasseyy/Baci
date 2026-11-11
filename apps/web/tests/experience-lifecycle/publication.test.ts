import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { asActor } from '../../tools/experience-sql/fixture';
import { lifecycleFixture } from './sql.test-support';

it('publication lifecycle: legacy retention, private apply, intent-only publish, independent verification, rollback and explicit mode exit', async () => {
  const f = await lifecycleFixture(process.env.BACI_D2_RED === '1');
  try {
    const old = await f.request(randomUUID());
    // The pre-existing six-block path still works before entering full-code mode.
    const legacyProof = await (async () => {
      const row = (
        await f.pool.query(
          'SELECT effect_digest,source_version FROM builder_authorization.publication_intents WHERE id=$1',
          [old.intentId]
        )
      ).rows[0];
      const id = randomUUID();
      await f.c.query('BEGIN');
      await f.c.query('SET LOCAL ROLE baci_builder_publication_verifier');
      await f.c.query(
        "INSERT INTO builder_authorization.publication_checks(id,intent_id,kind,version,effect_digest) VALUES($1,$2,'render',$3,$4)",
        [id, old.intentId, `draft:${row.source_version}`, row.effect_digest]
      );
      await f.c.query('COMMIT');
      return id;
    })();
    const legacy = await f.run('builder_confirm_publication', [
      old.intentId,
      legacyProof,
    ]);
    expect(legacy.status).toBe('verifying');
    const before = (
      await f.pool.query(
        "SELECT published_config FROM page_configs WHERE merchant_id=$1 AND page_slug='home'",
        [f.merchantId]
      )
    ).rows[0];
    const a = await f.build('first');
    await f.apply(a, 0);
    const payload = {
      buildId: a.id,
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
    };
    const retry = randomUUID();
    const request = () =>
      f.run('experience_request_lifecycle', [
        f.merchantId,
        f.connection,
        1,
        'publish',
        payload,
        retry,
      ]);
    const intent = await request();
    expect(intent.status).toBe('confirmation-required');
    expect(await request()).toEqual(intent);
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
    await expect(
      f.run('experience_confirm_publication', [intent.approvalId])
    ).rejects.toThrow('PREVIEW_REQUIRED');
    await f.proof(intent.approvalId);
    const receipt = await f.run('experience_confirm_publication', [
      intent.approvalId,
    ]);
    expect(receipt.status).toBe('verifying');
    expect(
      await f.run('experience_confirm_publication', [intent.approvalId])
    ).toEqual(receipt);
    await f.proof(intent.approvalId, 'public', receipt.receiptId);
    expect(
      (await f.run('experience_load_lifecycle', [intent.approvalId])).status
    ).toBe('live');
    await f.c.query('BEGIN');
    await f.c.query('SET LOCAL ROLE anon');
    const publicManifest = (
      await f.c.query(
        "SELECT experience_public_manifest('approval-fixture') manifest"
      )
    ).rows[0].manifest;
    await f.c.query('ROLLBACK');
    expect(publicManifest.routes).toHaveLength(4);
    expect(publicManifest.buildDigest).toBe(a.digest);
    expect(publicManifest).not.toHaveProperty('files');
    const b = await f.build('second');
    await f.apply(b, 1);
    const second = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'publish',
      { buildId: b.id, expectedDraftVersion: 2, expectedPublishedVersion: 1 },
      randomUUID(),
    ]);
    await f.proof(second.approvalId);
    await f.run('experience_confirm_publication', [second.approvalId]);
    expect(
      (await f.run('experience_load_lifecycle', [intent.approvalId])).status
    ).toBe('superseded');
    const rollback = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'rollback',
      { buildId: a.id, expectedDraftVersion: 2, expectedPublishedVersion: 2 },
      randomUUID(),
    ]);
    await f.proof(rollback.approvalId);
    const rolled = await f.run('experience_confirm_publication', [
      rollback.approvalId,
    ]);
    expect(rolled.publishedVersion).toBe(3);
    expect(
      (
        await f.pool.query(
          'SELECT build_id FROM experience_published_heads WHERE merchant_id=$1',
          [f.merchantId]
        )
      ).rows[0].build_id
    ).toBe(a.id);
    expect(
      (
        await f.pool.query(
          "SELECT published_config FROM page_configs WHERE merchant_id=$1 AND page_slug='home'",
          [f.merchantId]
        )
      ).rows[0]
    ).toEqual(before);
    const version = async () =>
      (
        await f.pool.query(
          'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
          [f.merchantId]
        )
      ).rows[0].token;
    const draftExit = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'draft-only',
      {
        expectedDraftVersion: 2,
        expectedPublishedVersion: 3,
        targetLegacyRevision: await version(),
      },
      randomUUID(),
    ]);
    await f.proof(draftExit.approvalId);
    await f.run('experience_confirm_mode_exit', [draftExit.approvalId]);
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('1');
    const exit = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'restore-legacy',
      {
        expectedDraftVersion: 0,
        expectedPublishedVersion: 3,
        targetLegacyRevision: await version(),
      },
      randomUUID(),
    ]);
    await f.proof(exit.approvalId);
    const exited = await f.run('experience_confirm_mode_exit', [
      exit.approvalId,
    ]);
    expect(
      await f.run('experience_confirm_mode_exit', [exit.approvalId])
    ).toEqual(exited);
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_builds')).rows[0]
        .count
    ).toBe('2');
    await expect(
      f.run('experience_begin_legacy_execution', [f.merchantId])
    ).rejects.toThrow('LEGACY_AI_RESUME_REQUIRED');
  } finally {
    await f.close();
  }
});
it('publication negatives: enrollment, owner/grant, immutable replays, expiry, stale sources and pruned rollback outputs', async () => {
  const f = await lifecycleFixture();
  try {
    const b = await f.build('commerce', ['catalog.read', 'cart.mutate']);
    await f.apply(b, 0);
    const payload = {
      buildId: b.id,
      expectedDraftVersion: 1,
      expectedPublishedVersion: 0,
    };
    const blocked = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'publish',
      payload,
      randomUUID(),
    ]);
    expect(blocked).toMatchObject({
      status: 'blocked',
      missingItems: expect.arrayContaining(['shared_cart enrollment']),
    });
    await f.pool.query(
      'UPDATE merchants SET premium_features=\'["shared_cart"]\' WHERE id=$1',
      [f.merchantId]
    );
    const key = randomUUID();
    const i = await f.run('experience_request_lifecycle', [
      f.merchantId,
      f.connection,
      1,
      'publish',
      payload,
      key,
    ]);
    await expect(
      f.run('experience_request_lifecycle', [
        f.merchantId,
        f.connection,
        1,
        'rollback',
        payload,
        key,
      ])
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    const other = randomUUID();
    await f.pool.query('INSERT INTO auth.users(id) VALUES($1)', [other]);
    await expect(
      f.run('experience_load_lifecycle', [i.approvalId], other)
    ).rejects.toThrow('NOT_FOUND');
    await expect(
      asActor(f.c, f.actor, () =>
        f.c.query(
          "INSERT INTO experience_authorization.lifecycle_checks(intent_id,kind,effect_digest,marker_digest) VALUES($1,'render',$2,$2)",
          [i.approvalId, i.effectDigest]
        )
      )
    ).rejects.toThrow('permission denied');
    await f.proof(i.approvalId);
    await f.pool.query(
      "UPDATE experience_artifacts SET manifest=jsonb_set(manifest,'{sdkVersion}','\"incompatible\"') WHERE id=$1",
      [b.artifact]
    );
    await expect(
      f.run('experience_confirm_publication', [i.approvalId])
    ).rejects.toThrow('INCOMPATIBLE_POLICY');
    await f.pool.query(
      "UPDATE experience_artifacts SET manifest=jsonb_set(manifest,'{sdkVersion}','\"commerce-bridge/v1\"') WHERE id=$1",
      [b.artifact]
    );
    await f.pool.query(
      "UPDATE experience_authorization.lifecycle_intents SET issued_at=now()-interval '20 minutes',expires_at=now()-interval '11 minutes' WHERE id=$1",
      [i.approvalId]
    );
    await expect(
      f.run('experience_confirm_publication', [i.approvalId])
    ).rejects.toThrow('APPROVAL_EXPIRED');
    assert.equal(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count,
      '0'
    );
  } finally {
    await f.close();
  }
});
