import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsApproveArgs } from '@/schemas/piggyvest/ops-approve-args';

const constructed = vi.hoisted(() => ({ configs: [] as unknown[] }));

vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      constructed.configs.push(config);
    }
    async connect() {
      throw new Error('no network in tests');
    }
    async query() {
      return { rows: [] };
    }
    async end() {
      return undefined;
    }
  },
}));

const { buildConnectionConfig } = await import('./build-connection-config');
const { openApproverSession } = await import('./open-approver-session');

const args: OpsApproveArgs = {
  host: 'db.abcdefghijklmnopqrst.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'pv_approver_amaka',
  reject: false,
  commit: false,
  help: false,
};

describe('openApproverSession default client', () => {
  beforeEach(() => {
    constructed.configs.length = 0;
  });

  it('hands pg every connection field, so nothing falls back to the environment', async () => {
    const config = buildConnectionConfig(args, 'typed-at-prompt', 'CA PEM');
    await expect(openApproverSession(config)).rejects.toThrow(
      'Could not sign in to the database.'
    );
    expect(constructed.configs).toEqual([config]);
  });
});
