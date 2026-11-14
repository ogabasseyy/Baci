import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOAL_RECHECK_DELAY_MS } from './goal-interest-routing';
import { p7RoutingGoalName } from './goal-wallet-names';
import { createMemoryJournal } from './mutation-journal';
import { runGoalRouting } from './proof-7-goal-routing';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

type Harness = ReturnType<typeof makeHarness>;
const goalPosts = (h: Harness) =>
  h.mock.calls.filter(
    (c) => c.method === 'POST' && c.pathname === '/api/v1/wallet/sub-account'
  ).length;

async function ready(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  const owner = {
    qa: h.ctx.qa,
    customerId: h.state.customerId ?? '',
    mainWalletId: h.state.mainWalletId,
  };
  return { h, owner, business: h.mock.sandbox.businessWalletId };
}
const byId = (runs: Awaited<ReturnType<typeof runGoalRouting>>) =>
  Object.fromEntries(runs.map((run) => [run.variant.id, run]));

describe('runGoalRouting: the four variants', () => {
  it('creates each with its 42-character baci-save- name and its own accrual and payout', async () => {
    const { h, owner, business } = await ready();
    const before = goalPosts(h);
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(goalPosts(h) - before).toBe(4);
    for (const id of ['a', 'b', 'c', 'd']) {
      const name = p7RoutingGoalName(h.ctx.qa.qaKey, id, 1);
      expect(runs[id].walletName).toBe(name);
      expect(name).toHaveLength(42);
      const wallet = h.mock.sandbox.wallet(runs[id].result?.walletId);
      expect(wallet?.name).toBe(name.replaceAll('-', ''));
    }
    const wallet = (id: string) =>
      h.mock.sandbox.wallet(runs[id].result?.walletId);
    expect(wallet('a')).toMatchObject({
      interestEnabled: true,
      payoutWalletId: null,
    });
    expect(wallet('b')).toMatchObject({
      interestEnabled: false,
      payoutWalletId: null,
    });
    expect(wallet('c')).toMatchObject({
      interestEnabled: true,
      payoutWalletId: owner.mainWalletId,
    });
    expect(wallet('d')).toMatchObject({
      interestEnabled: true,
      payoutWalletId: business,
    });
  });

  it('records interest_enabled and the payout as pseudonyms at once and after five minutes', async () => {
    const { h, owner, business } = await ready();
    const sleep = vi.fn(async (_ms: number) => undefined);
    h.ctx.sleep = sleep;
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(
      sleep.mock.calls.filter(([ms]) => ms === GOAL_RECHECK_DELAY_MS)
    ).toHaveLength(1);
    const readings = Object.fromEntries(
      Object.entries(runs).map(([id, run]) => [
        id,
        [run.atOnce, run.afterRecheck],
      ])
    );
    expect(readings).toEqual({
      a: [
        { interestEnabled: true, payout: 'null' },
        { interestEnabled: true, payout: 'null' },
      ],
      b: [
        { interestEnabled: false, payout: 'null' },
        { interestEnabled: false, payout: 'null' },
      ],
      c: [
        { interestEnabled: true, payout: 'main' },
        { interestEnabled: true, payout: 'main' },
      ],
      d: [
        { interestEnabled: true, payout: 'business' },
        { interestEnabled: true, payout: 'business' },
      ],
    });
  });

  it('sees a payout that changes during the wait in the five-minute reading only', async () => {
    const { h, owner, business } = await ready();
    h.ctx.sleep = async (ms) => {
      if (ms !== GOAL_RECHECK_DELAY_MS) return;
      for (const w of h.mock.sandbox.wallets)
        if (w.name.startsWith('bacisave') && w.payoutWalletId === null)
          w.payoutWalletId = w.id;
    };
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(runs.a.atOnce.payout).toBe('null');
    expect(runs.a.afterRecheck.payout).toBe('self');
  });

  it('polls the five-minute recheck like the first reading when the payout field shows late', async () => {
    const { h, owner, business } = await ready();
    h.ctx.sleep = async (ms) => {
      if (ms !== GOAL_RECHECK_DELAY_MS) return;
      // From the recheck on, each goal hides the payout field for two reads.
      for (const w of h.mock.sandbox.wallets)
        if (w.name.startsWith('bacisave')) w.payoutHiddenReads = 2;
    };
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(runs.d.atOnce.payout).toBe('business');
    expect(runs.d.afterRecheck.payout).toBe('business');
    expect(runs.c.afterRecheck.payout).toBe('main');
    expect(runs.a.afterRecheck.payout).toBe('null');
  });

  it('spends the polling budget once on a recheck that never shows the payout, then reports it absent', async () => {
    const { h, owner, business } = await ready({ maxPolls: 3 });
    h.ctx.sleep = async (ms) => {
      if (ms !== GOAL_RECHECK_DELAY_MS) return;
      for (const w of h.mock.sandbox.wallets)
        if (w.name.startsWith('bacisave')) w.payoutHiddenReads = 50;
    };
    const walletReads = () =>
      h.mock.calls.filter(
        (c) => c.method === 'GET' && c.pathname.startsWith('/api/v1/wallet/')
      ).length;
    const before = walletReads();
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(runs.d.atOnce.payout).toBe('business');
    expect(runs.d.afterRecheck.payout).toBe('absent');
    // Per goal: one settled first read, then 1 + maxPolls (3) recheck reads.
    expect(walletReads() - before).toBe(4 * (1 + 4));
  });

  it('reads self when the sandbox pays an unset goal to itself, and business when it inherits', async () => {
    const self = await ready({ mock: { subWalletPaysItselfWhenUnset: true } });
    const selfRuns = byId(
      await runGoalRouting(self.h.ctx, self.owner, self.business)
    );
    expect(selfRuns.a.afterRecheck.payout).toBe('self');
    expect(selfRuns.b.afterRecheck.payout).toBe('self');
    self.h.dispose();

    const inherit = await ready({ mock: { subWalletInheritsPayout: true } });
    inherit.h.mock.sandbox.customers[0].payoutWalletId = inherit.business;
    const inherited = byId(
      await runGoalRouting(inherit.h.ctx, inherit.owner, inherit.business)
    );
    expect(inherited.a.atOnce.payout).toBe('business');
  });
});

describe('runGoalRouting: what is not sent or not read', () => {
  it('skips the payout-main variant when the main wallet is unknown', async () => {
    const { h, owner, business } = await ready();
    const before = goalPosts(h);
    const runs = byId(
      await runGoalRouting(h.ctx, { ...owner, mainWalletId: null }, business)
    );
    expect(goalPosts(h) - before).toBe(3);
    expect(runs.c.result).toBeNull();
    expect(runs.c.afterRecheck.payout).toBe('unread');
  });

  it('rechecks only created wallets, and never waits when none was created', async () => {
    const { h, owner, business } = await ready({
      mock: { subAccountAcceptsPayout: false },
    });
    const runs = byId(await runGoalRouting(h.ctx, owner, business));
    expect(runs.d.result?.accepted).toBe(false);
    expect([runs.d.atOnce.payout, runs.d.afterRecheck.payout]).toEqual([
      'unread',
      'unread',
    ]);
    expect(runs.a.afterRecheck.payout).toBe('null');

    const sleep = vi.fn(async (_ms: number) => undefined);
    h.ctx.sleep = sleep;
    h.ctx.attempt = 2;
    await runGoalRouting(
      h.ctx,
      { ...owner, customerId: '00000000-0000-4000-8000-999999999999' },
      business
    );
    expect(sleep).not.toHaveBeenCalledWith(GOAL_RECHECK_DELAY_MS);
  });

  it('never resends a journaled variant: a re-run finds each by name and still reads it twice', async () => {
    const journal = createMemoryJournal();
    const first = await ready({ journal });
    await runGoalRouting(first.h.ctx, first.owner, first.business);
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();

    const h = makeHarness({ journal, runId: 'run2' });
    dispose = h.dispose;
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const before = goalPosts(h);
    const runs = byId(
      await runGoalRouting(
        h.ctx,
        {
          qa: h.ctx.qa,
          customerId: h.state.customerId ?? '',
          mainWalletId: h.state.mainWalletId,
        },
        h.mock.sandbox.businessWalletId
      )
    );
    expect(goalPosts(h)).toBe(before);
    expect(runs.b.result?.resumedOutcome).toBe('accepted');
    expect(runs.b.afterRecheck).toEqual({
      interestEnabled: false,
      payout: 'null',
    });
    expect(runs.d.afterRecheck.payout).toBe('business');
  });

  it('registers both name forms and the id, so a provider message echoing them leaks neither', async () => {
    const { h, owner, business } = await ready();
    const runs = await runGoalRouting(h.ctx, owner, business);
    for (const run of runs) {
      // The sandbox lists the name without hyphens; no pattern catches that
      // form, so only its registration keeps it out of evidence.
      const flat = run.walletName.replaceAll('-', '');
      expect(h.redactor.pseudonym(run.walletName)).toMatch(/^Q\d+$/);
      expect(h.redactor.pseudonym(flat)).toMatch(/^Q\d+$/);
      const echoed = h.redactor.message(
        `The subaccount name ${flat} has already been taken`
      );
      expect(echoed).not.toMatch(/bacisave|baci-save-/);
      expect(h.redactor.text(`listed as ${run.walletName}`)).not.toContain(
        run.walletName
      );
      const walletId = run.result?.walletId;
      expect(walletId).toBeTruthy();
      if (walletId)
        expect(h.redactor.text(`id ${walletId}`)).not.toContain(walletId);
    }
  });
});
