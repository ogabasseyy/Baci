import { describe, expect, it } from 'vitest';
import {
  opsApproveArgsSchema,
  opsDecisionResultSchema,
  opsOpenRequestRowSchema,
} from './ops-approvals';

const row = {
  request_id: '3f0e0000-0000-4000-8000-000000000001',
  action: 'treasury_sweep',
  label: 'Move Collection wallet money to the Ogabassey bank account',
  subject:
    'piggyvest_primary.wallet_transfers:0a0e0000-0000-4000-8000-000000000001',
  amount_kobo: '1500000',
  amount_naira: '₦15,000.00',
  destination: 'Ogabassey GTBank (bank 058) ••••6789',
  reason: null,
  requested_by: 'pv_ops_tunde',
  opened_at: new Date('2026-10-31T10:00:00Z'),
  expires_at: new Date('2026-11-01T10:00:00Z'),
  approvals: 1,
  decided_by_you: false,
  digest: 'a'.repeat(64),
};

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

describe('opsOpenRequestRowSchema', () => {
  it('parses a listing row and turns the bigint amount into a safe number', () => {
    const parsed = opsOpenRequestRowSchema.parse(row);
    expect(parsed.amountKobo).toBe(1_500_000);
    expect(parsed.requestId).toBe(row.request_id);
    expect(parsed.decidedByYou).toBe(false);
  });

  it.each([
    ['a negative amount', { amount_kobo: '-1' }],
    ['a fractional amount', { amount_kobo: '1.5' }],
    ['an unsafe amount', { amount_kobo: '9007199254740993' }],
    ['a short digest', { digest: 'abc' }],
    ['an unknown column', { approver: 'pv_approver_amaka' }],
  ])('rejects %s', (_label, change) => {
    expect(
      opsOpenRequestRowSchema.safeParse({ ...row, ...change }).success
    ).toBe(false);
  });
});

describe('opsDecisionResultSchema', () => {
  it('parses the decision result', () => {
    expect(
      opsDecisionResultSchema.parse({
        request_id: row.request_id,
        decision: 'approve',
        approvals: 2,
        state: 'open',
      })
    ).toEqual({
      requestId: row.request_id,
      decision: 'approve',
      approvals: 2,
      state: 'open',
    });
  });

  it('rejects an unknown state', () => {
    expect(
      opsDecisionResultSchema.safeParse({
        request_id: row.request_id,
        decision: 'approve',
        approvals: 2,
        state: 'consumed',
      }).success
    ).toBe(false);
  });
});
