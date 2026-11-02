import { afterEach, describe, expect, it } from 'vitest';
import { admitHouseWallet } from './house-wallet';
import type { MockCreated } from './mock-reply.test-support';
import { dataOf } from './mock-reply.test-support';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}

describe('admitHouseWallet', () => {
  it('admits the configured business wallet once it reads back bound to no API customer', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const admitted = await admitHouseWallet(h.ctx);
    const id = h.mock.sandbox.businessWalletId;
    expect(admitted).toEqual({ walletId: id, binding: 'unbound' });
    expect(h.state.houseWalletId).toBe(id);
    expect(h.state.authorized.has(id)).toBe(true);
    // Never treated as one of the QA customer's wallets.
    expect(h.state.wallets.map((w) => w.id)).not.toContain(id);
    // A second call reuses the admission without reading again.
    const reads = h.mock.calls.length;
    expect(await admitHouseWallet(h.ctx)).toEqual(admitted);
    expect(h.mock.calls.length).toBe(reads);
  });

  it('admits nothing when no business wallet is configured', async () => {
    const h = harness({ businessWalletId: null });
    await setupScenario(h.ctx);
    const result = await admitHouseWallet(h.ctx);
    expect(result.walletId).toBeNull();
    expect(result.binding).toBe('not_configured');
    expect(h.state.houseWalletId).toBeNull();
  });

  it("refuses a wallet that belongs to an API customer, even another customer's", async () => {
    const h = harness();
    const other = dataOf<MockCreated>(
      h.mock.sandbox.createCustomer(
        {
          bvn: '00099999999',
          email: 'synthetic+0ther0000000@example.test',
          name: 'Synthetic Customer',
          phone: '+234000999999',
        },
        true
      )
    );
    h.ctx.businessWalletId = other.wallet_id;
    await setupScenario(h.ctx);
    const result = await admitHouseWallet(h.ctx);
    expect(result).toMatchObject({ walletId: null, binding: 'bound' });
    expect(h.state.authorized.has(other.wallet_id)).toBe(false);
  });

  it("refuses the QA customer's own wallet named as the business wallet", async () => {
    const h = harness();
    await setupScenario(h.ctx);
    h.ctx.businessWalletId = h.state.mainWalletId;
    const result = await admitHouseWallet(h.ctx);
    expect(result).toMatchObject({ walletId: null, binding: 'qa_wallet' });
    expect(h.state.houseWalletId).toBeNull();
  });

  it('fails closed when the business wallet cannot be read', async () => {
    const h = harness({ businessWalletId: 'missing-house-wallet-01' });
    await setupScenario(h.ctx);
    const result = await admitHouseWallet(h.ctx);
    expect(result).toMatchObject({ walletId: null, binding: 'unread' });
    expect(h.state.authorized.has('missing-house-wallet-01')).toBe(false);
  });

  it('reads the binding in read-only mode but authorizes nothing', async () => {
    const h = harness({ mode: 'live-readonly' });
    const result = await admitHouseWallet(h.ctx);
    expect(result).toMatchObject({ walletId: null, binding: 'unbound' });
    expect(h.state.authorized.size).toBe(0);
  });
});
