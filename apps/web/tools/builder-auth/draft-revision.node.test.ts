import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { asActor, draftFixture } from './draft-fixture.ts';

test('secondary pages, deletes, branding and settings-only staff invalidate website revisions', async () => {
  const f = await draftFixture();
  const client = await f.pool.connect();
  try {
    const owner = randomUUID();
    const staff = randomUUID();
    const merchant = randomUUID();
    for (const actor of [owner, staff])
      await f.pool.query('INSERT INTO auth.users VALUES($1)', [actor]);
    await f.pool.query(
      'INSERT INTO merchants(id,user_id,business_name) VALUES($1,$2,$3)',
      [merchant, owner, 'Store']
    );
    await f.pool.query(
      "INSERT INTO staff_members VALUES($1,$2,$3,'active',$4)",
      [
        randomUUID(),
        merchant,
        staff,
        { settings: { edit: true }, builder: { view: false, edit: false } },
      ]
    );
    const revision = async () =>
      (
        await f.pool.query(
          'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
          [merchant]
        )
      ).rows[0]?.token;
    await asActor(client, owner, () =>
      client.query(
        "INSERT INTO page_configs(merchant_id,page_slug,page_name) VALUES($1,'home','Home')",
        [merchant]
      )
    );
    let previous = await revision();
    for (const run of [
      () =>
        client.query(
          "INSERT INTO page_configs(merchant_id,page_slug,page_name) VALUES($1,'about','About')",
          [merchant]
        ),
      () =>
        client.query(
          "DELETE FROM page_configs WHERE merchant_id=$1 AND page_slug='about'",
          [merchant]
        ),
      () =>
        client.query(
          "UPDATE merchants SET hero_image_ids=ARRAY['new-image'] WHERE id=$1",
          [merchant]
        ),
    ]) {
      await asActor(client, owner, run);
      const next = await revision();
      assert.notEqual(next, previous);
      previous = next;
    }
    await asActor(client, owner, () =>
      client.query("UPDATE merchants SET payout_currency='USD' WHERE id=$1", [
        merchant,
      ])
    );
    assert.notEqual(await revision(), previous);
    previous = await revision();
    await asActor(client, staff, () =>
      client.query(
        "UPDATE merchants SET logo_url='https://example.test/logo.png' WHERE id=$1",
        [merchant]
      )
    );
    assert.notEqual(await revision(), previous);
    const stamp = (
      await f.pool.query(
        'SELECT updated_at::text AS stamp FROM merchants WHERE id=$1',
        [merchant]
      )
    ).rows[0].stamp;
    await assert.rejects(
      asActor(client, staff, () =>
        client.query('SELECT update_merchant_identity_settings($1,$2,$3)', [
          merchant,
          { business_name: 'Forbidden rename' },
          stamp,
        ])
      ),
      /builder_edit_required_for_private_rename/
    );
    const privateRows = await asActor(client, staff, () =>
      client.query('SELECT id FROM builder_page_drafts WHERE merchant_id=$1', [
        merchant,
      ])
    );
    assert.equal((privateRows as { rowCount: number }).rowCount, 0);
    await asActor(client, owner, async () => {
      await client.query(
        "UPDATE merchants SET logo_url='https://example.test/a.png' WHERE id=$1",
        [merchant]
      );
      const first = await revisionInTransaction();
      await client.query(
        "UPDATE page_configs SET page_name='Changed' WHERE merchant_id=$1",
        [merchant]
      );
      assert.equal(await revisionInTransaction(), first);
      async function revisionInTransaction() {
        return (
          await client.query(
            'SELECT token FROM builder_website_revisions WHERE merchant_id=$1',
            [merchant]
          )
        ).rows[0].token;
      }
    });
    const unchanged = await revision();
    await asActor(client, owner, () =>
      client.query(
        "UPDATE merchants SET logo_url='https://example.test/a.png' WHERE id=$1",
        [merchant]
      )
    );
    assert.equal(await revision(), unchanged);
  } finally {
    client.release();
    await f.close();
  }
});
