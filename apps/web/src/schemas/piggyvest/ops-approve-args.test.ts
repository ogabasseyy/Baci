import { describe, expect, it } from 'vitest';
import { opsApproveArgsSchema } from './ops-approve-args';

describe('opsApproveArgsSchema', () => {
  const base = {
    host: 'db.example.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'pv_approver_amaka',
    reject: false,
    commit: false,
    help: false,
  };

  it('accepts a plain approver login and host', () => {
    expect(opsApproveArgsSchema.parse(base)).toEqual(base);
  });

  it('accepts the session-pooler form of a personal login', () => {
    const pooled = { ...base, user: 'pv_approver_amaka.abcdefghijklmnopqrst' };
    expect(opsApproveArgsSchema.parse(pooled)).toEqual(pooled);
    expect(
      opsApproveArgsSchema.safeParse({
        ...base,
        user: 'postgres.abcdefghijklmnopqrst',
      }).success
    ).toBe(false);
  });

  it.each([
    ['a connection string as host', { host: 'postgres://u:p@db/x' }],
    ['a host with credentials', { host: 'u:p@db.example.com' }],
    ['a reserved login', { user: 'postgres' }],
    ['a service login', { user: 'service_role' }],
    ['an uppercase login', { user: 'Approver' }],
    ['a bad request id', { request: 'not-a-uuid' }],
    ['an unknown key', { password: 'x' }],
  ])('rejects %s', (_label, change) => {
    expect(opsApproveArgsSchema.safeParse({ ...base, ...change }).success).toBe(
      false
    );
  });

  it('requires --request for a decision', () => {
    expect(
      opsApproveArgsSchema.safeParse({ ...base, commit: true }).success
    ).toBe(false);
    expect(
      opsApproveArgsSchema.safeParse({ ...base, reject: true }).success
    ).toBe(false);
  });
});
