import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asActor, draftFixture } from './draft-fixture.ts';

const config = {
  root: { props: { rendererVersion: 'baci-home-six-v1', title: 'Fixture' } },
  content: [],
};
const input = {
  businessName: 'Fixture Store',
  businessType: 'electronics',
  country: 'NG',
  requestedSlug: 'fixture-store',
};
test('private creation binds consent; same connection edits; CAS and revocation fence replays', async () => {
  const f = await draftFixture();
  const a = await f.pool.connect();
  const b = await f.pool.connect();
  try {
    const actor = randomUUID();
    const connection = randomUUID();
    const key = randomUUID();
    await f.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await f.pool.query(
      "INSERT INTO builder_authorization.connections(id,actor_user_id,provider_grant_id,scopes,allow_create_store,expires_at) VALUES($1::uuid,$2,$1::text,ARRAY['storefront.read','storefront.write'],true,now()+interval '1 hour')",
      [connection, actor]
    );
    const create = async () =>
      (
        await a.query('SELECT builder_create_draft($1,1,$2,$3,$4) AS result', [
          connection,
          key,
          input,
          config,
        ])
      ).rows[0].result;
    const first = (await asActor(a, actor, create)) as {
      storefrontId: string;
      version: string;
    };
    assert.equal(first.version.startsWith('draft:'), true);
    assert.deepEqual(await asActor(a, actor, create), first);
    const counts = await f.pool.query(
      'SELECT (SELECT count(*) FROM merchants) merchants,(SELECT count(*) FROM builder_page_drafts) drafts,(SELECT published_config FROM page_configs) published,(SELECT allowed_merchant_ids FROM builder_authorization.connections) targets'
    );
    assert.equal(counts.rows[0].merchants, '1');
    assert.equal(counts.rows[0].drafts, '1');
    assert.equal(counts.rows[0].published, null);
    assert.deepEqual(counts.rows[0].targets, [first.storefrontId]);
    await assert.rejects(
      asActor(a, actor, () =>
        a.query('SELECT builder_create_draft($1,1,$2,$3,$4)', [
          connection,
          key,
          { ...input, businessName: 'Changed' },
          config,
        ])
      ),
      /IDEMPOTENCY_CONFLICT/
    );
    const commit = async (client: typeof a, retry: string) =>
      (
        await client.query(
          'SELECT builder_commit_draft($1,1,$2,$3,$4,$5) result',
          [
            connection,
            first.storefrontId,
            first.version.slice(6),
            retry,
            {
              ...config,
              content: [
                { type: 'Text', props: { id: 'text', text: 'Edited' } },
              ],
            },
          ]
        )
      ).rows[0].result;
    const edited = (await asActor(a, actor, () => commit(a, randomUUID()))) as {
      version: string;
    };
    assert.notEqual(edited.version, first.version);
    const stale = (await asActor(b, actor, () => commit(b, randomUUID()))) as {
      code: string;
    };
    assert.equal(stale.code, 'STALE_DRAFT');
    const published = await f.pool.query(
      'SELECT published_config,is_published FROM page_configs'
    );
    assert.equal(published.rows[0].published_config, null);
    assert.equal(published.rows[0].is_published, false);
    await asActor(a, actor, () =>
      a.query('SELECT disconnect_builder_connection($1)', [connection])
    );
    await assert.rejects(asActor(a, actor, create), /CONNECTION_REVOKED/);
  } finally {
    a.release();
    b.release();
    await f.close();
  }
});

test('cutover removes raw draft columns; owner/staff RLS; legacy/new writer lock graph', async () => {
  const f = await draftFixture({ cutover: false });
  const a = await f.pool.connect();
  const b = await f.pool.connect();
  try {
    const owner = randomUUID();
    const viewer = randomUUID();
    const editor = randomUUID();
    const stranger = randomUUID();
    const merchant = randomUUID();
    const page = randomUUID();
    for (const user of [owner, viewer, editor, stranger])
      await f.pool.query('INSERT INTO auth.users VALUES($1)', [user]);
    await f.pool.query(
      'INSERT INTO merchants(id,user_id,business_name,template_id) VALUES($1,$2,$3,$4)',
      [merchant, owner, 'Store', 'puck']
    );
    await f.pool.query(
      "INSERT INTO page_configs(id,merchant_id,page_slug,page_name,draft_config,published_config) VALUES($1,$2,'home','Home',$3,$4)",
      [page, merchant, { private: 'secret' }, { public: 'visible' }]
    );
    await a.query('BEGIN');
    await a.query('SET LOCAL ROLE anon');
    assert.equal(
      (await a.query('SELECT draft_config FROM page_configs')).rows[0]
        .draft_config.private,
      'secret'
    );
    await a.query('ROLLBACK');
    await assert.rejects(
      f.pool.query('CALL builder_authorization.cutover_private_drafts()'),
      /coordinated_release/
    );
    await a.query('BEGIN');
    await a.query("SET LOCAL baci.builder_private_cutover='approved'");
    await a.query('CALL builder_authorization.cutover_private_drafts()');
    await a.query('COMMIT');
    await assert.rejects(
      f.pool.query('CALL builder_authorization.cutover_private_drafts()'),
      /already_applied/
    );
    await assert.rejects(
      asActor(a, owner, () =>
        a.query('CALL builder_authorization.cutover_private_drafts()')
      ),
      /permission denied/
    );
    await a.query('BEGIN');
    await a.query('SET LOCAL ROLE anon');
    await assert.rejects(
      a.query('SELECT draft_config FROM page_configs'),
      /does not exist/
    );
    await a.query('ROLLBACK');
    await a.query('BEGIN');
    await a.query('SET LOCAL ROLE anon');
    assert.deepEqual(
      (await a.query('SELECT published_config FROM page_configs')).rows[0]
        .published_config,
      { public: 'visible' }
    );
    await assert.rejects(
      a.query('SELECT draft_config FROM builder_page_drafts'),
      /permission denied/
    );
    await a.query('ROLLBACK');
    for (const [user, permission] of [
      [viewer, { builder: { view: true } }],
      [editor, { builder: { edit: true } }],
    ] as const)
      await f.pool.query(
        "INSERT INTO staff_members VALUES($1,$2,$3,'active',$4)",
        [randomUUID(), merchant, user, permission]
      );
    for (const user of [owner, viewer, editor]) {
      const result = await asActor(a, user, () =>
        a.query('SELECT draft_config FROM builder_page_drafts')
      );
      assert.equal(
        (result as { rows: { draft_config: unknown }[] }).rows.length,
        1
      );
    }
    const denied = await asActor(a, stranger, () =>
      a.query('SELECT draft_config FROM builder_page_drafts')
    );
    assert.equal((denied as { rows: unknown[] }).rows.length, 0);
    const viewerWrite = await asActor(a, viewer, () =>
      a.query('UPDATE builder_page_drafts SET draft_config=$1 WHERE id=$2', [
        { denied: true },
        page,
      ])
    );
    assert.equal((viewerWrite as { rowCount: number }).rowCount, 0);
    const unchanged = await f.pool.query(
      'SELECT draft_config FROM builder_page_drafts WHERE id=$1',
      [page]
    );
    assert.equal(unchanged.rows[0].draft_config.private, 'secret');

    const before = (
      await f.pool.query(
        'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
        [merchant]
      )
    ).rows[0].token;
    await asActor(a, editor, () =>
      a.query('UPDATE builder_page_drafts SET draft_config=$1 WHERE id=$2', [
        { edited: true },
        page,
      ])
    );
    assert.notEqual(
      (
        await f.pool.query(
          'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
          [merchant]
        )
      ).rows[0].token,
      before
    );
    const begin = async (client: typeof a) => {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='3s'");
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: owner, role: 'authenticated' }),
      ]);
    };
    // Browser writes first: connector's nonblocking guard returns a safe conflict.
    await begin(a);
    await a.query("UPDATE page_configs SET page_name='Legacy' WHERE id=$1", [
      page,
    ]);
    await begin(b);
    await assert.rejects(
      b.query('SELECT builder_website_guard($1)', [merchant]),
      /website_busy/
    );
    await b.query('ROLLBACK');
    await a.query('COMMIT');
    // Connector holds guard; browser already holds page row. Never deadlock waiting for revision.
    await begin(a);
    await a.query('SELECT id FROM page_configs WHERE id=$1 FOR UPDATE', [page]);
    await begin(b);
    await b.query('SELECT builder_website_guard($1)', [merchant]);
    const pid = Number(
      (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    );
    const pending = b.query(
      "UPDATE page_configs SET page_name='Connector' WHERE id=$1",
      [page]
    );
    const { setTimeout: delay } = await import('node:timers/promises');
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const status = await f.pool.query(
        'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
        [pid]
      );
      if (status.rows[0].blocked) {
        blocked = true;
        break;
      }
      await delay(5);
    }
    assert.equal(blocked, true);
    await assert.rejects(
      a.query("UPDATE page_configs SET page_name='Browser' WHERE id=$1", [
        page,
      ]),
      /website_busy/
    );
    await a.query('ROLLBACK');
    await pending;
    await b.query('COMMIT');
  } finally {
    await a.query('ROLLBACK');
    await b.query('ROLLBACK');
    a.release();
    b.release();
    await f.close();
  }
});
