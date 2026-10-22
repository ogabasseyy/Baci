// @vitest-environment node
import { expect, it } from 'vitest';
import { startLocalPostgresFixture } from './local-postgres-fixture';

it.skipIf(process.env.BACI_BUILDER_LOCAL_PG !== '1')(
  'owns an isolated Unix-socket PostgreSQL fixture and cleans it on close',
  async () => {
    const fixture = await startLocalPostgresFixture();
    try {
      const row = (
        await fixture.pool.query(
          'SELECT version() version,inet_server_addr() address'
        )
      ).rows[0];
      expect(row.version).toMatch(/PostgreSQL 18/);
      expect(row.address).toBeNull();
      expect(
        (await fixture.pool.query('SHOW listen_addresses')).rows[0]
          .listen_addresses
      ).toBe('');
    } finally {
      await fixture.close();
    }
  },
  30000
);
