import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpsApproveArgs } from '@/schemas/piggyvest/ops-approve-args';
import { buildConnectionConfig } from './build-connection-config';
import { createPgClient } from './create-pg-client';

const args: OpsApproveArgs = {
  host: 'db.abcdefghijklmnopqrst.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'pv_approver_amaka',
  reject: false,
  commit: false,
  help: false,
};

describe('createPgClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the real pg client from the given fields only, never the environment', () => {
    vi.stubEnv('PGPASSWORD', 'from-env');
    vi.stubEnv('PGSSLMODE', 'disable');
    vi.stubEnv('PGUSER', 'env_login');
    vi.stubEnv('PGHOST', 'env.example.com');
    vi.stubEnv('PGDATABASE', 'env_db');
    const client = createPgClient(
      buildConnectionConfig(args, 'typed-at-prompt')
    ) as unknown as Record<
      'password' | 'ssl' | 'user' | 'host' | 'database',
      unknown
    >;
    expect(client.password).toBe('typed-at-prompt');
    expect(client.ssl).toEqual({ rejectUnauthorized: true });
    expect(client.user).toBe('pv_approver_amaka');
    expect(client.host).toBe(args.host);
    expect(client.database).toBe('postgres');
  });
});
