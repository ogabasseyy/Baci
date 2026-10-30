import { afterEach, describe, expect, it } from 'vitest';
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

describe('ProviderApi reads (existing typed client + capture)', () => {
  it('reports status, envelope and typed-schema acceptance for a wallet read', async () => {
    const h = harness({ mode: 'live-readonly' });
    const customer = await h.mock.fetch(
      'https://staging.piggyvest.business/api/v1/customers?returnIfExist=true',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test_key_dryrunmock0000' },
        body: JSON.stringify({
          bvn: '00000000001',
          email: 'a@b.test',
          phone: '+2340000001',
          name: 'x',
        }),
      }
    );
    const walletId = (
      (await customer.json()) as { data: { wallet_id: string } }
    ).data.wallet_id;
    const call = await h.api.wallet(walletId);
    expect(call).toMatchObject({
      ok: true,
      httpStatus: 200,
      typedAccepted: true,
      declined: false,
    });
    expect(call.data).toMatchObject({ withdrawal_count: 0, balance: 0 });
  });

  it.each([
    ['docs', true],
    ['rich', false],
  ] as const)('reports whether the existing typed TSQ schema accepts a settled %s-shaped response', async (shape, accepted) => {
    const h = harness({ mock: { tsqShape: shape } });
    await setupScenario(h.ctx);
    const main = h.state.mainWalletId ?? '';
    const goal = h.state.goalWalletId ?? '';
    const sent = await h.api.transferWallet(
      h.ctx.qa,
      main,
      goal,
      1000,
      'x/w2w'
    );
    await h.api.verify(sent.reference); // pending
    const settled = await h.api.verify(sent.reference);
    expect(settled.ok).toBe(true);
    expect(settled.typedAccepted).toBe(accepted);
  });

  it('reports typedAccepted=false when the typed client cannot parse a 404', async () => {
    const h = harness({ mode: 'live-readonly' });
    const call = await h.api.verify('nope');
    expect(call.ok).toBe(false);
    expect(call.typedAccepted).toBe(false);
  });

  it('reports an unknown reference as a declined 404 with the provider message', async () => {
    const h = harness({ mode: 'live-readonly' });
    const call = await h.api.verify('pvbproof-unknown-reference');
    expect(call).toMatchObject({
      ok: false,
      httpStatus: 404,
      declined: true,
      message: 'Transaction not found',
    });
  });

  it('rethrows a guard refusal even though the typed client wraps fetch errors', async () => {
    const h = harness({
      mode: 'live-readonly',
      baseUrl: 'https://api.piggyvest.business',
    });
    expect(await refusal(() => h.api.wallet('some-wallet-id'))).toBe(
      'HOST_NOT_ALLOWED'
    );
    expect(h.mock.calls).toHaveLength(0);
  });
});

describe('ProviderApi gated mutations', () => {
  it('refuses every mutation in live-readonly without touching the network', async () => {
    const h = harness({ mode: 'live-readonly' });
    expect(
      await refusal(() => h.api.createCustomer(h.ctx.qa, 'p1/create'))
    ).toBe('MUTATION_IN_READONLY');
    expect(h.mock.calls).toHaveLength(0);
  });

  it('journals intent then outcome, and a re-run resumes instead of resending', async () => {
    const h = harness();
    const first = await h.api.createCustomer(h.ctx.qa, 'p1/create');
    expect(first).toMatchObject({ kind: 'sent', outcome: 'accepted' });
    if (first.kind !== 'sent') throw new Error('expected sent');
    expect(first.call.data).toMatchObject({ new_customer: true });
    expect(h.journal.entries().map((e) => e.phase)).toEqual([
      'intent',
      'outcome',
    ]);

    const postsBefore = h.mock.calls.filter((c) => c.method === 'POST').length;
    const again = await h.api.createCustomer(h.ctx.qa, 'p1/create');
    expect(again).toMatchObject({ kind: 'resumed', priorOutcome: 'accepted' });
    expect(h.mock.calls.filter((c) => c.method === 'POST')).toHaveLength(
      postsBefore
    );
  });

  it('only sends synthetic QA identities', async () => {
    const h = harness();
    await h.api.createCustomer(h.ctx.qa, 'p1/create');
    const body = h.mock.sandbox.customers[0];
    expect(body.email).toMatch(/^synthetic\+[0-9a-f]{12}@example\.test$/);
    expect(body.tpi).toBe('pvbproof:qa-customer-0001');
  });

  it('refuses a transfer touching a wallet that is not QA-owned', async () => {
    const h = harness();
    expect(
      await refusal(() =>
        h.api.transferWallet(
          h.ctx.qa,
          'house-wallet',
          'other-wallet',
          1000,
          'p2/w2w'
        )
      )
    ).toBe('WALLET_NOT_AUTHORIZED');
    expect(h.mock.calls).toHaveLength(0);
  });

  it('records an indeterminate outcome after a dropped connection and never resends it', async () => {
    const h = harness({ mock: { failNetworkOnce: ['/transfer/wallet'] } });
    h.state.authorized.add('wallet-aaaa');
    h.state.authorized.add('wallet-bbbb');
    const lost = await h.api.transferWallet(
      h.ctx.qa,
      'wallet-aaaa',
      'wallet-bbbb',
      1000,
      'p2/w2w'
    );
    expect(lost).toMatchObject({ kind: 'sent', outcome: 'indeterminate' });
    expect(h.journal.entries().at(-1)).toMatchObject({
      phase: 'outcome',
      outcome: 'indeterminate',
    });
    const rerun = await h.api.transferWallet(
      h.ctx.qa,
      'wallet-aaaa',
      'wallet-bbbb',
      1000,
      'p2/w2w'
    );
    expect(rerun).toMatchObject({
      kind: 'resumed',
      priorOutcome: 'indeterminate',
    });
  });

  it('classifies a provider decline as rejected', async () => {
    const h = harness();
    h.state.authorized.add('wallet-aaaa');
    h.state.authorized.add('wallet-bbbb');
    const declined = await h.api.transferWallet(
      h.ctx.qa,
      'wallet-aaaa',
      'wallet-bbbb',
      1000,
      'p2/w2w'
    );
    expect(declined).toMatchObject({ kind: 'sent', outcome: 'rejected' });
  });
});
