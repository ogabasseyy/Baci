import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  awaitTerminal,
  delta,
  readAllWallets,
  readWallet,
  statusOf,
} from './poll';
import type { CallResult } from './provider-ops';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => dispose?.());
function harness(...args: Parameters<typeof makeHarness>) {
  const h = makeHarness(...args);
  dispose = h.dispose;
  return h;
}

const call = (over: Partial<CallResult>): CallResult => ({
  ok: true,
  httpStatus: 200,
  data: undefined,
  envelope: null,
  message: null,
  declined: false,
  errorCode: null,
  typedAccepted: null,
  ...over,
});

describe('statusOf', () => {
  it('returns the provider status word on a successful call', () => {
    expect(statusOf(call({ data: { status: 'pending' } }))).toBe('pending');
    expect(statusOf(call({ data: { status: 'success' } }))).toBe('success');
  });

  it('falls back to the http status when the status is not a plain word', () => {
    expect(statusOf(call({ data: { status: 'has spaces' } }))).toBe('http_200');
    expect(statusOf(call({ data: { status: 42 } }))).toBe('http_200');
    expect(statusOf(call({ data: 'text' }))).toBe('http_200');
    expect(statusOf(call({ data: undefined }))).toBe('http_200');
  });

  it('reports failed calls by http status, and a dropped connection as network_error', () => {
    expect(
      statusOf(call({ ok: false, httpStatus: 404, data: undefined }))
    ).toBe('http_404');
    expect(
      statusOf(
        call({ ok: false, httpStatus: 503, data: { status: 'success' } })
      )
    ).toBe('http_503');
    expect(statusOf(call({ ok: false, httpStatus: null }))).toBe(
      'network_error'
    );
  });
});

describe('delta', () => {
  it('subtracts, and is null when either side is unknown', () => {
    expect(delta(3, 5)).toBe(2);
    expect(delta(5, 3)).toBe(-2);
    expect(delta(null, 5)).toBeNull();
    expect(delta(5, null)).toBeNull();
  });
});

describe('awaitTerminal', () => {
  async function submitted(options: Parameters<typeof makeHarness>[0] = {}) {
    const h = harness(options);
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
    return { h, main, reference: sent.reference };
  }

  it('returns success once TSQ settles, recording the states it passed through', async () => {
    const { h, main, reference } = await submitted();
    const watch = await awaitTerminal(h.ctx, reference, main);
    expect(watch).toMatchObject({
      terminal: 'success',
      polls: 2,
      statuses: ['pending', 'success'],
    });
    expect(watch.lastOk?.ok).toBe(true);
  });

  it('records a not-yet-indexed 404 as its own state before pending', async () => {
    const { h, main, reference } = await submitted({
      mock: { tsqNotFoundPolls: 1 },
    });
    const watch = await awaitTerminal(h.ctx, reference, main);
    expect(watch.statuses).toEqual(['http_404', 'pending', 'success']);
    expect(watch.terminal).toBe('success');
  });

  it('gives up with timeout after the polling budget, sleeping between polls', async () => {
    const { h, main, reference } = await submitted({
      maxPolls: 3,
      mock: { tsqPendingPolls: 50 },
    });
    const sleep = vi.fn(async () => undefined);
    h.ctx.sleep = sleep;
    const watch = await awaitTerminal(h.ctx, reference, main);
    expect(watch).toMatchObject({
      terminal: 'timeout',
      polls: 3,
      statuses: ['pending'],
    });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('treats an unknown reference as never terminal', async () => {
    const h = harness({ maxPolls: 2 });
    const watch = await awaitTerminal(h.ctx, 'pvbproof-never-sent', undefined);
    expect(watch).toMatchObject({
      terminal: 'timeout',
      statuses: ['http_404'],
      lastOk: null,
    });
  });

  it('stops at a failed state without waiting further', async () => {
    const h = harness({ maxPolls: 5 });
    const verify = vi
      .spyOn(h.api, 'verify')
      .mockResolvedValue(call({ data: { status: 'failed' } }));
    const watch = await awaitTerminal(h.ctx, 'ref', undefined);
    expect(watch).toMatchObject({ terminal: 'failed', polls: 1 });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('accepts the list/single spelling "successful" as success', async () => {
    const h = harness({ maxPolls: 5 });
    vi.spyOn(h.api, 'verify').mockResolvedValue(
      call({ data: { status: 'successful' } })
    );
    expect((await awaitTerminal(h.ctx, 'ref', undefined)).terminal).toBe(
      'success'
    );
  });
});

describe('readWallet / readAllWallets', () => {
  it('reads balance and withdrawal count', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    const reading = await readWallet(h.ctx, h.state.mainWalletId ?? '');
    expect(reading.withdrawalCount).toBe(0);
    expect(reading.balance).toBeGreaterThan(0);
    const all = await readAllWallets(h.ctx);
    expect([...all.keys()].sort()).toEqual(
      h.state.wallets.map((w) => w.id).sort()
    );
  });

  it('returns nulls when a FAILED read kept a schema-valid envelope (retained zero counters)', async () => {
    const h = harness({
      mock: {
        serverErrorData: { id: 'w', balance: 0, withdrawal_count: 0 },
      },
    });
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/wallet/'];
    const failed = await h.api.wallet(h.state.mainWalletId ?? '');
    expect(failed).toMatchObject({ ok: false, httpStatus: 503 });
    expect(failed.data).toMatchObject({ balance: 0, withdrawal_count: 0 });
    expect(await readWallet(h.ctx, h.state.mainWalletId ?? '')).toEqual({
      balance: null,
      withdrawalCount: null,
    });
  });

  it('returns nulls, not zeros, when the read fails or is malformed', async () => {
    const h = harness();
    await setupScenario(h.ctx);
    h.mock.sandbox.options.serverErrorPaths = ['/api/v1/wallet/'];
    expect(await readWallet(h.ctx, h.state.mainWalletId ?? '')).toEqual({
      balance: null,
      withdrawalCount: null,
    });
    vi.spyOn(h.api, 'wallet').mockResolvedValue(
      call({ data: { id: 'x', balance: 'lots' } })
    );
    expect(await readWallet(h.ctx, 'x')).toEqual({
      balance: null,
      withdrawalCount: null,
    });
  });
});
