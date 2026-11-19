import { afterEach, describe, expect, it } from 'vitest';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { bvnCollisionIdentity, ProofApi } from './provider-ops-proofs';
import { HarnessRefusal } from './safety-guards';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}
async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}
const posts = (h: ReturnType<typeof harness>) =>
  h.mock.calls.filter((call) => call.method === 'POST');

describe('bvnCollisionIdentity', () => {
  it("keeps the QA key's BVN but changes the identifier, email and phone, all synthetic", () => {
    const qa = {
      qaKey: 'qa-customer-0001',
      thirdPartyIdentifier: 'pvbproof:qa-customer-0001',
      goalWalletName: 'pvbproof-goal-qa-customer-0001',
    };
    const base = resolvePiggyvestStagingSyntheticIdentity(qa.qaKey);
    const alt = bvnCollisionIdentity(qa);
    expect(alt.bvn).toBe(base.bvn);
    expect(alt.thirdPartyIdentifier).toBe('pvbproof:qa-customer-0001:bvnalt');
    expect(alt.email).not.toBe(base.email.toLowerCase());
    expect(alt.phone).not.toBe(base.phone);
    expect(alt.email).toMatch(/^synthetic\+[0-9a-f]{12}@example\.test$/);
    expect(alt.phone).toMatch(/^\+234000\d{7}$/);
    // Deterministic: a re-run derives the same identity.
    expect(bvnCollisionIdentity(qa)).toEqual(alt);
  });
});

describe('ProofApi.createCustomerSameBvn', () => {
  it('sends one journaled POST with the same BVN under the other identifier, and never resends it', async () => {
    const h = harness();
    expect(h.api).toBeInstanceOf(ProofApi);
    await setupScenario(h.ctx);
    const before = posts(h).length;
    const sent = await h.api.createCustomerSameBvn(
      h.ctx.qa,
      'p1/bvn_collision'
    );
    expect(sent).toMatchObject({ kind: 'sent', outcome: 'accepted' });
    expect(posts(h).length).toBe(before + 1);
    expect(posts(h).at(-1)?.search).toBe('?returnIfExist=true');
    // The mock matches on BVN, so the original customer comes back.
    if (sent.kind !== 'sent') throw new Error('expected sent');
    expect(sent.call.data).toMatchObject({
      customer_id: h.state.customerId,
      new_customer: false,
    });
    const again = await h.api.createCustomerSameBvn(
      h.ctx.qa,
      'p1/bvn_collision'
    );
    expect(again).toMatchObject({ kind: 'resumed' });
    expect(posts(h).length).toBe(before + 1);
  });
});

describe('ProofApi.transferWalletAgain', () => {
  it('re-sends the exact body and reference of an accepted transfer in its own slot', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    const goal = h.state.goalWalletId ?? '';
    const first = await h.api.transferWallet(
      h.ctx.qa,
      main,
      goal,
      100_000,
      'p2/w2w'
    );
    expect(first).toMatchObject({ kind: 'sent', outcome: 'accepted' });
    const again = await h.api.transferWalletAgain(
      h.ctx.qa,
      main,
      goal,
      100_000,
      first.reference,
      'p2/duplicate_reference',
      'p2/w2w'
    );
    expect(again.reference).toBe(first.reference);
    // The mock refuses a repeated reference.
    expect(again).toMatchObject({ kind: 'sent', outcome: 'rejected' });
    if (again.kind !== 'sent') throw new Error('expected sent');
    expect(again.call.message).toBe('Duplicate reference');
  });

  it('refuses to re-send a reference the journal never sent, before any request', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const before = h.mock.calls.length;
    expect(
      await refusal(() =>
        h.api.transferWalletAgain(
          h.ctx.qa,
          h.state.mainWalletId ?? '',
          h.state.goalWalletId ?? '',
          100_000,
          'pvbproof-not-ours-0001',
          'p2/duplicate_reference',
          'p2/w2w'
        )
      )
    ).toBe('REFERENCE_REUSE');
    expect(h.mock.calls.length).toBe(before);
  });
});
