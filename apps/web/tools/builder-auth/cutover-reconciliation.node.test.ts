import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { draftFixture } from './draft-fixture.ts';

test('cutover refuses equal-timestamp divergent drafts without dropping either copy', async () => {
  const f = await draftFixture({ cutover: false });
  const client = await f.pool.connect();
  try {
    const user = randomUUID();
    const merchant = randomUUID();
    const page = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [user]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      user,
    ]);
    await f.pool.query(
      "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config,updated_at) VALUES($1,$2,'home','Home',$3,'2026-01-01T00:00:00Z')",
      [page, merchant, { version: 'legacy' }]
    );
    await f.pool.query(
      "INSERT INTO builder_page_drafts(id,merchant_id,draft_config,updated_at) VALUES($1,$2,$3,'2026-01-01T00:00:00Z')",
      [page, merchant, { version: 'private' }]
    );
    await client.query('BEGIN');
    await client.query("SET LOCAL baci.builder_private_cutover='approved'");
    await assert.rejects(
      client.query('CALL builder_authorization.cutover_private_drafts()'),
      /builder_private_draft_reconciliation_conflict/
    );
    await client.query('ROLLBACK');
    const rows = await f.pool.query(
      'SELECT p.draft_config AS legacy, d.draft_config AS private FROM page_configs p JOIN builder_page_drafts d ON d.id=p.id WHERE p.id=$1',
      [page]
    );
    assert.deepEqual(rows.rows, [
      { legacy: { version: 'legacy' }, private: { version: 'private' } },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await f.close();
  }
});

test('cutover preserves matching and newer private drafts while keeping both procedures operator-only', async () => {
  const f = await draftFixture({ cutover: false });
  const client = await f.pool.connect();
  try {
    const user = randomUUID();
    const merchant = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [user]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      user,
    ]);
    for (const [slug, updated, legacy, current] of [
      ['same', '2026-01-01T00:00:00Z', { value: 'same' }, { value: 'same' }],
      ['newer', '2026-01-02T00:00:00Z', { value: 'old' }, { value: 'new' }],
    ] as const) {
      const page = randomUUID();
      await f.pool.query(
        "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config,updated_at) VALUES($1,$2,$3,'Page',$4,'2026-01-01T00:00:00Z')",
        [page, merchant, slug, legacy]
      );
      await f.pool.query(
        'INSERT INTO builder_page_drafts(id,merchant_id,draft_config,updated_at) VALUES($1,$2,$3,$4)',
        [page, merchant, current, updated]
      );
    }
    for (const name of [
      'cutover_private_drafts',
      'cutover_private_drafts_unchecked_20261113',
    ]) {
      for (const role of [
        'anon',
        'authenticated',
        'service_role',
        'baci_builder_auth_storage',
      ]) {
        const permission = await f.pool.query(
          'SELECT has_function_privilege($1,$2,$3) AS allowed',
          [role, `builder_authorization.${name}()`, 'EXECUTE']
        );
        assert.equal(permission.rows[0].allowed, false);
      }
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await assert.rejects(
        client.query(`CALL builder_authorization.${name}()`),
        /permission denied/
      );
      await client.query('ROLLBACK');
    }
    await client.query('BEGIN');
    await client.query("SET LOCAL baci.builder_private_cutover='approved'");
    await client.query('CALL builder_authorization.cutover_private_drafts()');
    await client.query('COMMIT');
    const rows = await f.pool.query(
      'SELECT p.page_slug, d.draft_config FROM page_configs p JOIN builder_page_drafts d ON d.id=p.id ORDER BY p.page_slug'
    );
    assert.deepEqual(rows.rows, [
      { page_slug: 'newer', draft_config: { value: 'new' } },
      { page_slug: 'same', draft_config: { value: 'same' } },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await f.close();
  }
});

test('cutover rejects a private draft bound to the wrong merchant', async () => {
  const f = await draftFixture({ cutover: false });
  const client = await f.pool.connect();
  try {
    const [firstUser, secondUser, firstMerchant, secondMerchant, page] =
      Array.from({ length: 5 }, () => randomUUID());
    await f.pool.query('INSERT INTO auth.users VALUES($1),($2)', [
      firstUser,
      secondUser,
    ]);
    await f.pool.query(
      'INSERT INTO merchants(id,user_id) VALUES($1,$2),($3,$4)',
      [firstMerchant, firstUser, secondMerchant, secondUser]
    );
    await f.pool.query(
      "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config) VALUES($1,$2,'home','Home',$3)",
      [page, firstMerchant, { version: 'legacy' }]
    );
    await f.pool.query(
      'INSERT INTO builder_page_drafts(id,merchant_id,draft_config) VALUES($1,$2,$3)',
      [page, secondMerchant, { version: 'private' }]
    );
    await client.query('BEGIN');
    await client.query("SET LOCAL baci.builder_private_cutover='approved'");
    await assert.rejects(
      client.query('CALL builder_authorization.cutover_private_drafts()'),
      /builder_private_draft_reconciliation_conflict/
    );
    await client.query('ROLLBACK');
    const rows = await f.pool.query(
      'SELECT p.merchant_id AS legacy, d.merchant_id AS private FROM page_configs p JOIN builder_page_drafts d ON d.id=p.id WHERE p.id=$1',
      [page]
    );
    assert.deepEqual(rows.rows, [
      { legacy: firstMerchant, private: secondMerchant },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await f.close();
  }
});

test('cutover refuses divergent drafts when the legacy timestamp is missing', async () => {
  const f = await draftFixture({ cutover: false });
  const client = await f.pool.connect();
  try {
    const [user, merchant, page] = Array.from({ length: 3 }, () =>
      randomUUID()
    );
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [user]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      user,
    ]);
    await f.pool.query(
      "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config,updated_at) VALUES($1,$2,'home','Home',$3,NULL)",
      [page, merchant, { version: 'legacy' }]
    );
    await f.pool.query(
      'INSERT INTO builder_page_drafts(id,merchant_id,draft_config) VALUES($1,$2,$3)',
      [page, merchant, { version: 'private' }]
    );
    await client.query('BEGIN');
    await client.query("SET LOCAL baci.builder_private_cutover='approved'");
    await assert.rejects(
      client.query('CALL builder_authorization.cutover_private_drafts()'),
      /builder_private_draft_reconciliation_conflict/
    );
    await client.query('ROLLBACK');
    const rows = await f.pool.query(
      'SELECT p.draft_config AS legacy, d.draft_config AS private FROM page_configs p JOIN builder_page_drafts d ON d.id=p.id WHERE p.id=$1',
      [page]
    );
    assert.deepEqual(rows.rows, [
      { legacy: { version: 'legacy' }, private: { version: 'private' } },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await f.close();
  }
});

test('rolling back an uncommitted cutover restores legacy drafts and columns', async () => {
  const f = await draftFixture({ cutover: false });
  const client = await f.pool.connect();
  try {
    const [user, merchant, page] = Array.from({ length: 3 }, () =>
      randomUUID()
    );
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [user]);
    await f.pool.query('INSERT INTO merchants(id,user_id) VALUES($1,$2)', [
      merchant,
      user,
    ]);
    await f.pool.query(
      "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config) VALUES($1,$2,'home','Home',$3)",
      [page, merchant, { value: 'synthetic draft' }]
    );
    await client.query('BEGIN');
    await client.query("SET LOCAL baci.builder_private_cutover='approved'");
    await client.query('CALL builder_authorization.cutover_private_drafts()');
    const copied = await client.query(
      'SELECT draft_config FROM builder_page_drafts WHERE id=$1',
      [page]
    );
    assert.deepEqual(copied.rows, [
      { draft_config: { value: 'synthetic draft' } },
    ]);
    await client.query('ROLLBACK');
    const legacy = await f.pool.query(
      'SELECT draft_config FROM page_configs WHERE id=$1',
      [page]
    );
    assert.deepEqual(legacy.rows, [
      { draft_config: { value: 'synthetic draft' } },
    ]);
    const privateDraft = await f.pool.query(
      'SELECT id FROM builder_page_drafts WHERE id=$1',
      [page]
    );
    assert.equal(privateDraft.rowCount, 0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await f.close();
  }
});
