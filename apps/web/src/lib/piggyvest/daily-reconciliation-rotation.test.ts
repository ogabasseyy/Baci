import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
  ledger,
  makeDeps,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

const DAY_MS = 86_400_000;
const WALLET_PAGE = 500;
const TOTAL_WALLETS = 1100;
const allWallets = Array.from({ length: TOTAL_WALLETS }, (_, index) => ({
  walletId: `rotation-wallet-${String(index).padStart(5, '0')}`,
  expectedKobo: 100,
}));

/** Mirrors the database window: consecutive slots tile the ordered list. */
function windowFor(slot: number) {
  const start = (slot * WALLET_PAGE) % TOTAL_WALLETS;
  return allWallets.filter(
    (_, position) =>
      (position - start + TOTAL_WALLETS) % TOTAL_WALLETS < WALLET_PAGE
  );
}

function rotatingExecutor() {
  return vi.fn(async (statement: string, params: unknown[]) => {
    if (statement.includes('read_credit_gap_ledger'))
      return { rows: [{ result: ledger() }] };
    const slot = (JSON.parse(String(params[2])) as { rotationSlot: number })
      .rotationSlot;
    const wallets = windowFor(slot);
    return {
      rows: [
        {
          result: snapshot({
            wallets,
            walletsTotal: TOTAL_WALLETS,
            walletsDeferred: TOTAL_WALLETS - wallets.length,
          }),
        },
      ],
    };
  });
}

describe('daily reconciliation rotation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the UTC day number as the rotation slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T23:59:59.000Z'));
    const { deps, execute } = makeDeps({ nowMs: () => Date.now() });
    await runPiggyvestDailyReconciliation({ env, deps });
    const [, params] = execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(JSON.parse(String(params[2]))).toEqual({
      staleAfterSeconds: 1800,
      rotationSlot: Math.floor(Date.parse('2026-11-04T00:00:00Z') / DAY_MS),
    });
  });

  it('checks every one of more than 500 wallets across consecutive runs', async () => {
    const checked = new Set<string>();
    const startDay = 20_000;
    for (let day = 0; day < 3; day += 1) {
      const executor = rotatingExecutor();
      const { deps } = makeDeps({
        nowMs: () => (startDay + day) * DAY_MS,
        createExecutor: vi.fn(() => executor) as never,
        retrieveWallet: vi.fn(async (_c: unknown, id: string) => {
          checked.add(id);
          return { id, business_id: 'synthetic-business', balance: 100 };
        }) as never,
      });
      await runPiggyvestDailyReconciliation({ env, deps });
    }
    expect(checked.size).toBe(TOTAL_WALLETS);
  });

  it('reports how many wallets a capped run deferred, and does not page for them', async () => {
    const executor = rotatingExecutor();
    const { deps } = makeDeps({
      nowMs: () => 20_000 * DAY_MS,
      createExecutor: vi.fn(() => executor) as never,
      retrieveWallet: vi.fn(async (_c: unknown, id: string) => ({
        id,
        business_id: 'synthetic-business',
        balance: 100,
      })) as never,
    });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toEqual({
      status: 'reported',
      report: 'clean',
      emailed: true,
      paged: false,
    });
    const sent = vi.mocked(deps.sendEmail).mock.calls[0][0];
    expect(sent.subject).toContain('600 wallet(s) deferred to later runs');
    expect(sent.textContent).toContain(
      'Goal wallet balances checked: 500 of 1100.'
    );
    expect(deps.emitAlert).not.toHaveBeenCalled();
  });

  it('fails the run, never reads clean, when the day number is unusable', async () => {
    const { deps } = makeDeps({ nowMs: () => Number.NaN });
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'failed', paged: true });
  });
});
