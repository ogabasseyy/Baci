import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { startBarePostgresFixture } from './bare-postgres-fixture.ts';
import { verifyProductionAuthDatabaseRole } from './production-role.ts';

test('requires the dedicated least-privilege login and storage execution role on real PostgreSQL', async () => {
  const db = await startBarePostgresFixture();
  let broker: Pool | undefined;
  try {
    await db.pool.query(
      'CREATE ROLE authenticated NOLOGIN; CREATE ROLE extra_capability NOLOGIN; CREATE ROLE baci_builder_auth_storage NOLOGIN NOINHERIT; CREATE ROLE baci_builder_auth_login LOGIN NOINHERIT; GRANT baci_builder_auth_storage TO baci_builder_auth_login;'
    );
    broker = new Pool({
      ...db.connection,
      user: 'baci_builder_auth_login',
      options: '-c role=baci_builder_auth_storage',
      max: 1,
    });
    await verifyProductionAuthDatabaseRole(broker);
    await db.pool.query('GRANT authenticated TO baci_builder_auth_login');
    await assert.rejects(
      verifyProductionAuthDatabaseRole(broker),
      /UNSAFE_AUTH_DATABASE_SESSION/
    );
    await db.pool.query('REVOKE authenticated FROM baci_builder_auth_login');
    await verifyProductionAuthDatabaseRole(broker);
    await db.pool.query('GRANT extra_capability TO baci_builder_auth_storage');
    await assert.rejects(
      verifyProductionAuthDatabaseRole(broker),
      /UNSAFE_AUTH_DATABASE_SESSION/
    );
    await db.pool.query(
      'REVOKE extra_capability FROM baci_builder_auth_storage'
    );
    await db.pool.query('ALTER ROLE baci_builder_auth_storage BYPASSRLS');
    await assert.rejects(
      verifyProductionAuthDatabaseRole(broker),
      /UNSAFE_AUTH_DATABASE_SESSION/
    );
    await db.pool.query('ALTER ROLE baci_builder_auth_storage NOBYPASSRLS');
    await verifyProductionAuthDatabaseRole(broker);
    await db.pool.query('ALTER ROLE baci_builder_auth_login INHERIT');
    await assert.rejects(
      verifyProductionAuthDatabaseRole(broker),
      /UNSAFE_AUTH_DATABASE_SESSION/
    );
  } finally {
    await broker?.end();
    await db.close();
  }
});
