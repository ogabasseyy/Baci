// @vitest-environment node
import { expect, it } from 'vitest';
import { startLocalPostgresFixture } from './local-postgres-fixture';

it.skipIf(process.env.BACI_BUILDER_LOCAL_PG !== '1')(
  'owns an isolated Unix-socket PostgreSQL fixture and cleans it on close',
  async () => {
    const fixture = await startLocalPostgresFixture({
      binDirectory: process.env.BACI_BUILDER_LOCAL_PG_BIN,
      major: process.env.BACI_BUILDER_LOCAL_PG_MAJOR === '17' ? 17 : 18,
    });
    try {
      const row = (
        await fixture.pool.query(
          'SELECT version() version,inet_server_addr() address'
        )
      ).rows[0];
      expect(row.version).toMatch(
        new RegExp(
          `PostgreSQL ${process.env.BACI_BUILDER_LOCAL_PG_MAJOR === '17' ? 17 : 18}`
        )
      );
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

it.skipIf(
  process.env.BACI_BUILDER_LOCAL_PG !== '1' ||
    process.env.BACI_BUILDER_LOCAL_PG_MAJOR !== '17' ||
    !process.env.BACI_BUILDER_LOCAL_PG_BIN
)(
  'uses an explicitly selected local PostgreSQL17 binary without Docker',
  async () => {
    const fixture = await startLocalPostgresFixture({
      binDirectory: process.env.BACI_BUILDER_LOCAL_PG_BIN,
      major: 17,
    });
    try {
      expect(
        (await fixture.pool.query('SHOW server_version_num')).rows[0]
          .server_version_num
      ).toMatch(/^17/);
    } finally {
      await fixture.close();
    }
  },
  30000
);

it('rejects a relative binary directory before starting a cluster', async () => {
  await expect(
    startLocalPostgresFixture({ binDirectory: 'relative/bin', major: 17 })
  ).rejects.toThrow('must be absolute');
});
it.skipIf(
  process.env.BACI_BUILDER_LOCAL_PG !== '1' ||
    !process.env.BACI_BUILDER_LOCAL_PG_BIN
)('rejects a mismatched selected major before initialization', async () => {
  await expect(
    startLocalPostgresFixture({
      binDirectory: process.env.BACI_BUILDER_LOCAL_PG_BIN,
      major: process.env.BACI_BUILDER_LOCAL_PG_MAJOR === '17' ? 18 : 17,
    })
  ).rejects.toThrow('Expected explicitly selected');
});
