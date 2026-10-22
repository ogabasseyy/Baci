import { describe, expect, it } from 'vitest';
import { startLocalPostgrest } from './local-postgrest-fixture';

describe('local Data API isolation', () => {
  it('rejects remote or relative database bindings before starting a process', async () => {
    await expect(
      startLocalPostgrest({
        databaseSocket: 'postgres://remote/database',
        role: 'builder_draft_rest_fixture',
        jwks: {},
      })
    ).rejects.toThrow('Invalid local Data API binding');
    await expect(
      startLocalPostgrest({
        databaseSocket: '/tmp/local-db',
        role: 'postgres',
        jwks: {},
      })
    ).rejects.toThrow('Invalid local Data API binding');
  });
  it('rejects PATH-selected binaries', async () => {
    await expect(
      startLocalPostgrest({
        databaseSocket: '/tmp/local-db',
        role: 'builder_draft_rest_fixture',
        jwks: {},
        binary: 'postgrest',
      })
    ).rejects.toThrow('PostgREST binary must be absolute');
  });
});
