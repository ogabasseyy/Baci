import { describe, expect, it } from 'vitest';
import type { OpsApproveArgs } from '@/schemas/piggyvest/ops-approve-args';
import { buildConnectionConfig } from './build-connection-config';

const args: OpsApproveArgs = {
  host: 'db.abcdefghijklmnopqrst.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'pv_approver_amaka',
  reject: false,
  commit: false,
  help: false,
};

describe('buildConnectionConfig', () => {
  it('uses verified TLS for a remote host and the prompted password only', () => {
    const config = buildConnectionConfig(args, 'prompted-secret', 'CA PEM');
    expect(config).toMatchObject({
      host: args.host,
      port: 5432,
      database: 'postgres',
      user: 'pv_approver_amaka',
      password: 'prompted-secret',
      ssl: { rejectUnauthorized: true, ca: 'CA PEM' },
      application_name: 'baci-piggyvest-approve',
      // Non-empty, so pg never substitutes PGOPTIONS or PGCLIENTENCODING.
      options: '-c search_path=pg_catalog',
      client_encoding: 'UTF8',
    });
  });

  it('allows plain TCP only on this machine', () => {
    expect(buildConnectionConfig({ ...args, host: '127.0.0.1' }, 'x').ssl).toBe(
      false
    );
    expect(buildConnectionConfig(args, 'x').ssl).toEqual({
      rejectUnauthorized: true,
    });
  });
});
