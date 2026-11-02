import { describe, expect, it } from 'vitest';
import type { OpsApproveArgs } from '@/schemas/piggyvest/ops-approve-args';
import {
  type ApproverConnectionConfig,
  buildConnectionConfig,
} from './build-connection-config';
import type { PgClientLike } from './create-pg-client';
import { openApproverSession } from './open-approver-session';
import { OpsRefusal } from './ops-refusal';

const args: OpsApproveArgs = {
  host: 'db.abcdefghijklmnopqrst.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'pv_approver_amaka',
  reject: false,
  commit: false,
  help: false,
};

const listRow = {
  request_id: '3f0e0000-0000-4000-8000-000000000001',
  action: 'treasury_sweep',
  label: 'Move Collection wallet money to the Ogabassey bank account',
  subject:
    'piggyvest_primary.wallet_transfers:0a0e0000-0000-4000-8000-000000000001',
  amount_kobo: '1500000',
  amount_naira: '₦15,000.00',
  destination: 'Bank 058 ••••6789 "Ogabassey GTBank"',
  reason: null,
  requested_by: 'pv_ops_tunde',
  opened_at: new Date('2026-10-31T10:00:00Z'),
  expires_at: new Date('2026-11-01T10:00:00Z'),
  approvals: 0,
  decided_by_you: false,
  digest: 'c'.repeat(64),
};

function fakeClient(
  respond: (text: string, values?: unknown[]) => unknown[] | Error,
  login = 'pv_approver_amaka'
) {
  const calls: { text: string; values?: unknown[] }[] = [];
  let ended = false;
  let config: ApproverConnectionConfig | undefined;
  const create = (given: ApproverConnectionConfig): PgClientLike => {
    config = given;
    return {
      connect: async () => undefined,
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        if (text === 'SELECT session_user::text AS login') {
          return { rows: [{ login }] };
        }
        const result = respond(text, values);
        if (result instanceof Error) throw result;
        return { rows: result };
      },
      end: async () => {
        ended = true;
      },
    };
  };
  return { create, calls, ended: () => ended, config: () => config };
}

describe('openApproverSession', () => {
  it('refuses a connection that signed in as another login', async () => {
    const client = fakeClient(() => [], 'postgres');
    await expect(
      openApproverSession(buildConnectionConfig(args, 'x'), client.create)
    ).rejects.toThrow('Signed in as a different login');
    expect(client.ended()).toBe(true);
  });

  it('lists open requests through the approver function with explicit columns', async () => {
    const client = fakeClient(() => [listRow]);
    const session = await openApproverSession(
      buildConnectionConfig(args, 'x'),
      client.create
    );
    const rows = await session.listOpen();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountKobo).toBe(1_500_000);
    const listing = client.calls[1].text;
    expect(listing).toContain(
      'FROM piggyvest_approvals.list_open_ops_requests()'
    );
    expect(listing).not.toContain('*');
  });

  it('records a decision with the confirmed amount and digest as parameters', async () => {
    const client = fakeClient(() => [
      {
        result: {
          request_id: listRow.request_id,
          decision: 'approve',
          approvals: 1,
          state: 'open',
        },
      },
    ]);
    const session = await openApproverSession(
      buildConnectionConfig(args, 'x'),
      client.create
    );
    const result = await session.decide({
      requestId: listRow.request_id,
      decision: 'approve',
      amountKobo: 1_500_000,
      digest: listRow.digest,
    });
    expect(result).toEqual({
      requestId: listRow.request_id,
      decision: 'approve',
      approvals: 1,
      state: 'open',
    });
    expect(client.calls[1].text).toBe(
      'SELECT piggyvest_approvals.approve_ops_request($1::uuid, $2::text, $3::bigint, $4::text) AS result'
    );
    expect(client.calls[1].values).toEqual([
      listRow.request_id,
      'approve',
      '1500000',
      listRow.digest,
    ]);
    await session.close();
    expect(client.ended()).toBe(true);
  });

  it('turns a database refusal into its code and hides other errors', async () => {
    const refusing = fakeClient(
      () => new Error('ops_approval_already_decided')
    );
    const session = await openApproverSession(
      buildConnectionConfig(args, 'x'),
      refusing.create
    );
    await expect(
      session.decide({
        requestId: listRow.request_id,
        decision: 'approve',
        amountKobo: 1,
        digest: listRow.digest,
      })
    ).rejects.toEqual(new OpsRefusal('ops_approval_already_decided'));

    const failing = fakeClient(
      () => new Error('relation "x" does not exist at 10.0.0.1')
    );
    const other = await openApproverSession(
      buildConnectionConfig(args, 'x'),
      failing.create
    );
    await expect(other.listOpen()).rejects.toThrow(
      /^The database could not complete the request\.$/
    );
  });
});
