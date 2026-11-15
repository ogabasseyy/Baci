import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Pool } from 'pg';
import { startBarePostgresFixture } from './bare-postgres-fixture.ts';
import {
  createOwnerPreviewNonceStore,
  ownerPreviewNonceDeadlines,
} from './owner-preview-nonce.ts';

test('durably consumes each signed nonce once across concurrent clients and service restarts', async () => {
  const db = await startBarePostgresFixture();
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
      ...ownerPreviewNonceDeadlines,
    });
    const store = await createOwnerPreviewNonceStore(pool, {
      requireDeadlines: true,
    });
    const lock = await db.pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(
        'LOCK TABLE builder_authorization.owner_preview_nonces IN ACCESS EXCLUSIVE MODE'
      );
      await assert.rejects(store('c'.repeat(64), Date.now() + 30000), {
        code: '55P03',
      });
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    await assert.rejects(pool.query('SELECT pg_sleep(5)'), { code: '57014' });
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
    await assert.rejects(
      createOwnerPreviewNonceStore(restarted, { requireDeadlines: true }),
      /UNBOUNDED_OWNER_PREVIEW_DATABASE_SESSION/
    );
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
  const db = await startBarePostgresFixture();
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

test('disposes the connection when the owner nonce pool hits the driver read timeout', async () => {
  const db = await startBarePostgresFixture();
  const pool = new Pool({
    ...db.connection,
    ...ownerPreviewNonceDeadlines,
    max: 1,
  });
  const backendPid = async () =>
    (await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0].pid;
  try {
    const firstPid = await backendPid();
    // Force the driver backstop to trigger before the server timeout in this fixture.
    await pool.query("SET statement_timeout = '5s'");
    await assert.rejects(
      pool.query('SELECT pg_sleep(4)'),
      /Query read timeout/
    );
    assert.notEqual(await backendPid(), firstPid);
  } finally {
    await pool.end();
    await db.close();
  }
});
