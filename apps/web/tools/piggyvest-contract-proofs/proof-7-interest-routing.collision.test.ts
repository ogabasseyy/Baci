import { afterEach, describe, expect, it } from 'vitest';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { runProof7 } from './proof-7-interest-routing';
import { proof7Key } from './qa-keys';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());

describe('proof 7: a returnIfExist answer must belong to the proof 7 key', () => {
  it('creates no sub-wallet under another customer that shares the synthetic BVN', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);

    // Someone else's customer already owns the BVN this proof's key derives.
    const qa7Key = proof7Key(h.ctx.qa.qaKey, h.ctx.attempt);
    const { bvn } = resolvePiggyvestStagingSyntheticIdentity(qa7Key);
    h.mock.sandbox.createCustomer(
      {
        bvn,
        email: 'someone-else@example.test',
        phone: '+2340009999999',
        name: 'Someone Else',
        third_party_identifier: 'someone-else',
      },
      false
    );
    const foreign = h.mock.sandbox.customers.at(-1);
    expect(foreign?.bvn).toBe(bvn);
    const foreignWallets = () =>
      h.mock.sandbox.wallets.filter((w) => w.customerId === foreign?.id);
    const before = foreignWallets().length;

    const result = await runProof7(h.ctx);

    expect(foreignWallets()).toHaveLength(before);
    expect(result.status).toBe('inconclusive');
    expect(result.values.interest_routing_verdict).toBe('unconfirmed');
    expect(result.notes.join(' ')).toMatch(/not proven/i);
  });
});
