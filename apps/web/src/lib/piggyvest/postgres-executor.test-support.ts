import { vi } from 'vitest';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';

export function postgresExecutorFixture() {
  const configuration = {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: '/private/tmp/baci-piggyvest-runtime.synthetic/socket',
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role: 'piggyvest_staging_intake',
    port: 55443,
  };
  const session = {
    database_name: configuration.database,
    role_name: configuration.role,
    login_role: configuration.role,
    is_superuser: false,
    bypasses_rls: false,
    creates_role: false,
    creates_database: false,
    replicates: false,
    has_memberships: false,
    fsync_enabled: 'on',
    synchronous_commit: 'on',
    is_replica: false,
  };
  const client = {
    connect: vi.fn(async (): Promise<void> => undefined),
    query: vi.fn(async (statement: string, _parameters?: unknown[]) => ({
      command: statement === 'COMMIT' ? 'COMMIT' : 'SELECT',
      rows:
        statement === PIGGYVEST_POSTGRES_EXECUTOR.verifySession
          ? [session]
          : [],
    })),
    end: vi.fn(async () => undefined),
    on: vi.fn(),
    getTransactionStatus: vi.fn(() => 'I'),
  };
  return { configuration, session, client };
}
