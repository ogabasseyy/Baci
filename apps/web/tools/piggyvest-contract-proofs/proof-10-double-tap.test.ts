import { describe, expect, it } from 'vitest';
import { AMOUNTS_KOBO } from './constants';
import { MovementLedger } from './movement-ledger';
import {
  FUND_GOAL,
  stepDoubleTap,
  TAP_ONCE,
  TAP_SENDS_ONCE,
} from './proof-10-fund-double-tap';
import {
  answer,
  installCleanup,
  setup,
  transferPosts,
} from './proof-10-test-support.test-support';

installCleanup();

describe('S8 double tap', () => {
  it('stays unknown when an accepted repeat is hidden past the polling budget', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(true);
    h.mock.sandbox.options.listLagReads = 8;
    h.mock.sandbox.options.balanceLagReads = 8;
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_wire_outcome).toBe('accepted');
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('stays unknown when the repeat response is lost and a hidden booking may exist', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    h.mock.sandbox.options.listLagReads = 8;
    h.mock.sandbox.options.balanceLagReads = 8;
    h.ctx.faults?.loseNextResponse('/api/v1/transfer/wallet');
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_wire_outcome).toBe('indeterminate');
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('does not repeat on the wire while the original funding is still pending', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { tsqPendingPolls: 7 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(false);
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(transferPosts(h)).toBe(before);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('sends nothing on the second tap and the provider holds one transfer', async () => {
    const { h, b, main, goal, fund } = await setup();
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    // The only new POST is the wire-level repeat of the SAME reference.
    expect(transferPosts(h)).toBe(before + 1);
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('yes');
    expect(answer(b, h, TAP_ONCE)).toBe('yes');
    expect(b.build(h.ctx).values).toMatchObject({
      double_tap_app_second_send: 'not_sent',
      double_tap_wire_outcome: 'rejected',
      double_tap_rows_with_reference: 1,
      double_tap_extra_debit_kobo: 0,
    });
  });

  it('reports a provider that books the repeat as NOT exactly one transfer', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept' },
    });
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('yes');
    expect(answer(b, h, TAP_ONCE)).toBe('no');
    expect(b.build(h.ctx).values.double_tap_extra_debit_kobo).toBe(
      AMOUNTS_KOBO.s8FundGoal
    );
  });

  it('stays unknown, not no, when the post-repeat list read drops the original row', async () => {
    const { h, b, main, goal, fund } = await setup();
    const real = h.ctx.api.transactions.bind(h.ctx.api);
    h.ctx.api.transactions = (() => {
      let reads = 0;
      return async (...args: Parameters<typeof real>) => {
        reads += 1;
        const out = await real(...args);
        return reads === 1 ? out : { ...out, data: { edges: [] } };
      };
    })();
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_rows_with_reference).toBe(0);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('reports an unreconciled accepted repeat as not settled', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept', tsqPendingPolls: 3 },
      maxPolls: 6,
    });
    h.mock.sandbox.options.balanceLagReads = 8;
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund)).toBe(false);
  });

  it('reports a rejected repeat with settled balances as settled', async () => {
    const { h, b, main, goal, fund } = await setup();
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund)).toBe(true);
  });

  it('stays unknown, not no, when main is credited during the repeat window', async () => {
    const { h, b, main, goal, fund } = await setup();
    h.mock.sandbox.wallet(main)!.balance += 500;
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_extra_debit_kobo).toBe(-500);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('stays unknown when there is no accepted fund transfer to tap again', async () => {
    const { h, b, main, goal } = await setup();
    const posts = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, null);
    expect(transferPosts(h)).toBe(posts);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
    expect(answer(b, h, TAP_SENDS_ONCE)).toBe('unknown');
  });

  it('answers no, not yes, when an accepted repeat shows a second record while its status stays pending', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept' },
    });
    const real = h.ctx.api.verify.bind(h.ctx.api);
    h.ctx.api.verify = async (...args: Parameters<typeof real>) => ({
      ...(await real(...args)),
      data: { status: 'pending' },
    });
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(b.build(h.ctx).values.double_tap_wire_outcome).toBe('accepted');
    expect(answer(b, h, TAP_ONCE)).toBe('no');
  });
});

describe('S8 stale balances after a terminal success', () => {
  it('answers unknown, not no, when balances lag past the polling budget', async () => {
    const { h, b, fund } = await setup({
      mock: { balanceLagReads: 8 },
      maxPolls: 6,
    });
    expect(fund?.terminalSuccess).toBe(true);
    expect(fund?.mainDeltaKobo).toBeNull();
    expect(answer(b, h, FUND_GOAL)).toBe('unknown');
    expect(b.build(h.ctx).values.fund_goal_main_delta_kobo).toBeNull();
  });

  it('does not tap again on a funding whose balances never moved', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { balanceLagReads: 8 },
      maxPolls: 6,
    });
    const before = transferPosts(h);
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    expect(transferPosts(h)).toBe(before);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });

  it('keeps a partial, both-sided repeat unsettled and the ledger not quiet', async () => {
    const { h, b, main, goal, fund } = await setup({
      mock: { duplicateReference: 'accept' },
    });
    expect(fund).not.toBeNull();
    const mainBefore = fund?.mainBalanceKobo as number;
    const goalBefore = fund?.goalBalanceKobo as number;
    const half = AMOUNTS_KOBO.s8FundGoal / 2;
    const real = h.ctx.api.wallet.bind(h.ctx.api);
    let repeated = false;
    const again = h.ctx.api.transferWalletAgain.bind(h.ctx.api);
    h.ctx.api.transferWalletAgain = async (...args) => {
      repeated = true;
      return again(...args);
    };
    h.ctx.api.wallet = async (id) => {
      const call = await real(id);
      const data = (call.data ?? {}) as Record<string, unknown>;
      if (!repeated) return call;
      // Half of the repeat has landed on each side and holds still.
      const balance =
        id === main
          ? mainBefore - half
          : id === goal
            ? goalBefore + half
            : null;
      return balance === null ? call : { ...call, data: { ...data, balance } };
    };
    const ledger = new MovementLedger();
    expect(await stepDoubleTap(h.ctx, b, main, goal, fund, ledger)).toBe(false);
    expect(ledger.isQuiet(main, goal)).toBe(false);
  });

  it('never answers no from a row count alone: an extra row with unchanged balances is unknown', async () => {
    const { h, b, main, goal, fund } = await setup();
    const real = h.ctx.api.transactions.bind(h.ctx.api);
    const again = h.ctx.api.transferWalletAgain.bind(h.ctx.api);
    let repeated = false;
    h.ctx.api.transferWalletAgain = async (...args) => {
      repeated = true;
      return again(...args);
    };
    h.ctx.api.transactions = async (...args) => {
      const out = await real(...args);
      const data = (out.data ?? {}) as { edges?: unknown[] };
      // A second row sharing the reference (a fee leg or paging duplicate).
      return repeated && Array.isArray(data.edges) && data.edges.length > 0
        ? {
            ...out,
            data: { ...data, edges: [...data.edges, data.edges[0]] },
          }
        : out;
    };
    await stepDoubleTap(h.ctx, b, main, goal, fund);
    const values = b.build(h.ctx).values;
    expect(values.double_tap_extra_debit_kobo).toBe(0);
    expect(values.double_tap_rows_with_reference).toBe(2);
    expect(answer(b, h, TAP_ONCE)).toBe('unknown');
  });
});
