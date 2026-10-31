import { afterEach, describe, expect, it } from 'vitest';
import { recordGoalWallets } from './proof-7-goals';
import { ProofBuilder } from './proof-builder';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';
import type { Answer } from './types';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

async function run(
  options: Parameters<typeof makeHarness>[0] = {},
  destinationPaths: string[] = ['interest_payout_wallet'],
  afterSetup: (h: ReturnType<typeof makeHarness>) => void = () => undefined
) {
  const h = makeHarness(options);
  dispose = h.dispose;
  await setupScenario(h.ctx);
  afterSetup(h);
  const b = new ProofBuilder('p7', 'T');
  const owner = { qa: h.ctx.qa, customerId: h.state.customerId ?? '' };
  await recordGoalWallets(
    h.ctx,
    b,
    owner,
    h.mock.sandbox.businessWalletId,
    destinationPaths
  );
  const result = b.build(h.ctx);
  const answer = (id: string): Answer | undefined =>
    result.findings.find((f) => f.id === id)?.answer;
  return { h, result, answer };
}

describe('recordGoalWallets', () => {
  it('records created, not-inherited, accepted and named-destination findings on the happy path', async () => {
    const { answer, result } = await run();
    expect(answer('goal_without_payout_created')).toBe('yes');
    expect(answer('goal_without_payout_inherits_business_payout')).toBe('no');
    expect(answer('goal_explicit_payout_accepted')).toBe('yes');
    expect(answer('goal_explicit_readback_names_payout_destination')).toBe(
      'yes'
    );
    expect(result.values.goal_explicit_http_status).toBe(200);
  });

  it('warns loudly when a goal wallet inherits the business payout wallet', async () => {
    const { answer, result } = await run(
      { mock: { subWalletInheritsPayout: true } },
      ['interest_payout_wallet'],
      (h) => {
        // The customer carries the business payout wallet, as a proof-7 customer does.
        h.mock.sandbox.customers[0].payoutWalletId =
          h.mock.sandbox.businessWalletId;
      }
    );
    expect(answer('goal_without_payout_inherits_business_payout')).toBe('yes');
    expect(result.notes.join(' ')).toMatch(/INHERITS/);
  });

  it('records the rejection message of an explicit payout, redacted', async () => {
    const { answer, result } = await run({
      mock: { subAccountAcceptsPayout: false },
    });
    expect(answer('goal_explicit_payout_accepted')).toBe('no');
    expect(result.values.goal_explicit_error_message).toBe(
      'Invalid interest payout wallet'
    );
    expect(answer('goal_without_payout_created')).toBe('yes');
  });

  it('leaves inheritance unknown when the main wallet never named the destination field', async () => {
    const { answer } = await run({}, []);
    expect(answer('goal_without_payout_inherits_business_payout')).toBe(
      'unknown'
    );
  });

  it('leaves every goal finding unknown when there is no QA customer to own the wallets', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    const b = new ProofBuilder('p7', 'T');
    await recordGoalWallets(
      h.ctx,
      b,
      null,
      h.mock.sandbox.businessWalletId,
      []
    );
    const result = b.build(h.ctx);
    expect(result.findings.map((f) => f.answer)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(
      result.findings.every((f) => f.detail === 'no QA customer available')
    ).toBe(true);
  });

  it('marks the proof inconclusive and explains it when a sub-wallet slot was already executed', async () => {
    const first = await run();
    const { customers, wallets } = first.h.mock.sandbox;
    const journal = first.h.journal;
    first.h.dispose();
    const h = makeHarness({ journal, runId: 'run2' });
    dispose = h.dispose;
    h.mock.sandbox.customers = customers;
    h.mock.sandbox.wallets = wallets;
    await setupScenario(h.ctx);
    const b = new ProofBuilder('p7', 'T');
    await recordGoalWallets(
      h.ctx,
      b,
      { qa: h.ctx.qa, customerId: h.state.customerId ?? '' },
      h.mock.sandbox.businessWalletId,
      ['interest_payout_wallet']
    );
    const result = b.build(h.ctx);
    expect(result.status).toBe('inconclusive');
    expect(result.notes.join(' ')).toMatch(/--new-attempt/);
  });
});
