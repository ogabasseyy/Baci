import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Pool } from 'pg';
import { startLocalPostgresFixture } from './local-postgres-fixture.ts';
import { createOwnerPreviewNonceStore } from './owner-preview-nonce.ts';

test('durably consumes each signed nonce once across concurrent clients and service restarts', async () => {
  const db = await startLocalPostgresFixture({
    major: 17,
    binDirectory: '/opt/homebrew/opt/postgresql@17/bin',
  });
  let pool: Pool | undefined;
  let restarted: Pool | undefined;
  try {
    await db.pool.query(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE SCHEMA builder_authorization;'
    );
    const directory = new URL(
      '../../../../supabase/migrations/',
      import.meta.url
    );
    const migrations = readdirSync(directory).filter((file) =>
      file.endsWith('_owner_preview_nonce.sql')
    );
    assert.equal(migrations.length, 1);
    await db.pool.query(
      readFileSync(new URL(migrations[0], directory), 'utf8')
    );
    await db.pool.query(
      'CREATE ROLE baci_owner_preview_login LOGIN NOINHERIT; GRANT baci_owner_preview_nonce TO baci_owner_preview_login'
    );
    await assert.rejects(
      createOwnerPreviewNonceStore(db.pool),
      /UNSAFE_OWNER_PREVIEW_DATABASE_SESSION/
    );
    pool = new Pool({
      ...db.connection,
      user: 'baci_owner_preview_login',
      options: '-c role=baci_owner_preview_nonce',
      max: 4,
    });
    const store = await createOwnerPreviewNonceStore(pool);
    const expiry = Date.now() + 30000;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store('a'.repeat(64), expiry))
    );
    assert.equal(results.filter(Boolean).length, 1);
    await pool.end();
    pool = undefined;
    restarted = new Pool({
      ...db.connection,
      user: 'baci_owner_preview_login',
      options: '-c role=baci_owner_preview_nonce',
    });
    assert.equal(
      await (await createOwnerPreviewNonceStore(restarted))(
        'a'.repeat(64),
        expiry
      ),
      false
    );
    assert.equal(
      await (await createOwnerPreviewNonceStore(restarted))(
        'b'.repeat(64),
        expiry
      ),
      true
    );
    await db.pool.query('ALTER ROLE baci_owner_preview_nonce BYPASSRLS');
    await assert.rejects(
      createOwnerPreviewNonceStore(restarted),
      /UNSAFE_OWNER_PREVIEW_DATABASE_SESSION/
    );
    await db.pool.query('ALTER ROLE baci_owner_preview_nonce NOBYPASSRLS');
    assert.equal(
      (
        await restarted.query(
          'DELETE FROM builder_authorization.owner_preview_nonces'
        )
      ).rowCount,
      0
    );
    await assert.rejects(
      restarted.query(
        "INSERT INTO builder_authorization.owner_preview_nonces(nonce,expires_at) VALUES($1,now()+interval '1 hour')",
        [Buffer.alloc(32, 3)]
      )
    );
    await assert.rejects(
      restarted.query(
        'SELECT nonce FROM builder_authorization.owner_preview_nonces'
      )
    );
    await assert.rejects(restarted.query('SET ROLE authenticated'));
    const user = await db.pool.connect();
    try {
      await user.query('SET ROLE authenticated');
      await assert.rejects(
        user.query('SELECT * FROM builder_authorization.owner_preview_nonces')
      );
      await assert.rejects(
        user.query(
          "INSERT INTO builder_authorization.owner_preview_nonces(nonce,expires_at) VALUES($1,now()+interval '30 seconds')",
          [Buffer.alloc(32, 4)]
        )
      );
    } finally {
      await user.query('RESET ROLE');
      user.release();
    }
  } finally {
    await pool?.end();
    await restarted?.end();
    await db.close();
  }
});

test('refuses a pre-existing nonce role with unrelated privileges', async () => {
  const db = await startLocalPostgresFixture({
    major: 17,
    binDirectory: '/opt/homebrew/opt/postgresql@17/bin',
  });
  try {
    await db.pool.query(
      'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE baci_owner_preview_nonce NOLOGIN NOINHERIT; GRANT authenticated TO baci_owner_preview_nonce; CREATE SCHEMA builder_authorization;'
    );
    const directory = new URL(
      '../../../../supabase/migrations/',
      import.meta.url
    );
    const file = readdirSync(directory).find((name) =>
      name.endsWith('_owner_preview_nonce.sql')
    );
    assert.ok(file);
    await assert.rejects(
      db.pool.query(readFileSync(new URL(file, directory), 'utf8')),
      /UNSAFE_OWNER_PREVIEW_NONCE_ROLE/
    );
  } finally {
    await db.close();
  }
});
