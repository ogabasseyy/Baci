import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryJournal } from './mutation-journal';
import { runGoalVariant } from './proof-7-goal-variants';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
const posts = (h: ReturnType<typeof makeHarness>) =>
  h.mock.calls.filter((c) => c.method === 'POST').length;

async function ready(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = harness(options);
  await setupScenario(h.ctx);
  const owner = { qa: h.ctx.qa, customerId: h.state.customerId ?? '' };
  const business = h.mock.sandbox.businessWalletId;
  return { h, owner, business };
}
const unset = { slot: 'v/unset', nameSuffix: '-vunset', payoutWalletId: null };

describe('runGoalVariant: created now', () => {
  it('creates a goal wallet with its own payout unset and reads it back', async () => {
    const { h, owner, business } = await ready();
    const result = await runGoalVariant(h.ctx, owner, business, unset);
    expect(result).toMatchObject({
      exists: true,
      accepted: true,
      resumedOutcome: null,
      errorMessage: null,
    });
    expect(result.readback?.payoutFieldPaths).toEqual([
      'interest_payout_wallet',
    ]);
    expect(result.readback?.matchesTarget).toEqual([]);
  });

  it('with an explicit payout, the readback names the business wallet', async () => {
    const { h, owner, business } = await ready();
    const result = await runGoalVariant(h.ctx, owner, business, {
      slot: 'v/explicit',
      nameSuffix: '-vexplicit',
      payoutWalletId: business,
    });
    expect(result.accepted).toBe(true);
    expect(result.readback?.matchesTarget).toEqual(['interest_payout_wallet']);
  });

  it('registers the new wallet id with the redactor', async () => {
    const { h, owner, business } = await ready();
    const result = await runGoalVariant(h.ctx, owner, business, unset);
    const leaked = JSON.stringify(result.readbackData);
    expect(h.redactor.text(leaked)).not.toMatch(/01M2T[0-9A-F]{21}/);
  });
});

describe('runGoalVariant: rejected, unknown and unreadable', () => {
  it('records a provider rejection with its message and no readback', async () => {
    const { h, owner, business } = await ready({
      mock: { subAccountAcceptsPayout: false },
    });
    const result = await runGoalVariant(h.ctx, owner, business, {
      slot: 'v/explicit',
      nameSuffix: '-vexplicit',
      payoutWalletId: business,
    });
    expect(result).toMatchObject({
      accepted: false,
      exists: false,
      httpStatus: 400,
      errorMessage: 'Invalid interest payout wallet',
      readback: null,
    });
  });

  it('leaves acceptance and existence unknown after a dropped connection', async () => {
    const h = harness({ mock: { failNetworkOnce: ['/wallet/sub-account'] } });
    await h.api.createCustomer(h.ctx.qa, 'v/create');
    const result = await runGoalVariant(
      h.ctx,
      { qa: h.ctx.qa, customerId: h.mock.sandbox.customers[0].id },
      h.mock.sandbox.businessWalletId,
      unset
    );
    expect(result).toMatchObject({
      accepted: null,
      exists: null,
      httpStatus: null,
      readback: null,
    });
    expect(h.journal.entries().at(-1)).toMatchObject({
      phase: 'outcome',
      outcome: 'indeterminate',
    });
  });

  it('keeps accepted/exists but drops the readback when the readback itself fails', async () => {
    const { h, owner, business } = await ready();
    const original = h.api.wallet.bind(h.api);
    h.api.wallet = async (walletId) => ({
      ...(await original(walletId)),
      ok: false,
    });
    const result = await runGoalVariant(h.ctx, owner, business, unset);
    expect(result).toMatchObject({
      accepted: true,
      exists: true,
      readback: null,
    });
  });
});

describe('runGoalVariant: resumed slot', () => {
  it('does not resend; finds the wallet by its deterministic name and reads it back', async () => {
    const journal = createMemoryJournal();
    const first = await ready({ journal });
    await runGoalVariant(first.h.ctx, first.owner, first.business, unset);
    const { customers, wallets } = first.h.mock.sandbox;
    first.h.dispose();

    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const before = posts(h);
    const result = await runGoalVariant(
      h.ctx,
      { qa: h.ctx.qa, customerId: h.state.customerId ?? '' },
      h.mock.sandbox.businessWalletId,
      unset
    );
    expect(posts(h)).toBe(before);
    expect(result).toMatchObject({ resumedOutcome: 'accepted', exists: true });
    expect(result.readback).not.toBeNull();
  });

  it('reports exists=false when the journal says executed but no wallet has that name', async () => {
    const journal = createMemoryJournal();
    const first = await ready({ journal });
    await runGoalVariant(first.h.ctx, first.owner, first.business, unset);
    const { customers } = first.h.mock.sandbox;
    first.h.dispose();

    const h = harness({ journal, runId: 'run2' });
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = [];
    h.state.authorized.clear();
    const result = await runGoalVariant(
      h.ctx,
      { qa: h.ctx.qa, customerId: customers[0].id },
      h.mock.sandbox.businessWalletId,
      unset
    );
    expect(result).toMatchObject({
      resumedOutcome: 'accepted',
      exists: false,
      readback: null,
    });
  });
});
