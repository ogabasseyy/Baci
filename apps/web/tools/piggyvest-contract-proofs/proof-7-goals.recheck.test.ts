import { afterEach, describe, expect, it } from 'vitest';
import { GOAL_RECHECK_DELAY_MS } from './goal-interest-routing';
import { p7RoutingGoalName } from './goal-wallet-names';
import { disposeGoalHarness, runGoals } from './proof-7-goals.test-support';

afterEach(disposeGoalHarness);

describe('recordGoalWallets: the 5-minute recheck decides, field by field', () => {
  it('judges inheritance by the 5-minute reading: null at once, business later, is a yes with the warning', async () => {
    const { answer, result } = await runGoals(
      {},
      ['interest_payout_wallet'],
      (h) => {
        const name = p7RoutingGoalName(h.ctx.qa.qaKey, 'a', 1).replaceAll(
          '-',
          ''
        );
        h.ctx.sleep = async (ms) => {
          if (ms !== GOAL_RECHECK_DELAY_MS) return;
          const goal = h.mock.sandbox.wallets.find((w) => w.name === name);
          if (goal) goal.payoutWalletId = h.mock.sandbox.businessWalletId;
        };
      }
    );
    expect(result.values.goal_a_payout_at_0m).toBe('null');
    expect(result.values.goal_a_payout_at_5m).toBe('business');
    expect(answer('goal_without_payout_inherits_business_payout')).toBe('yes');
    expect(answer('goal_a_interest_stays_in_goal')).toBe('no');
    expect(result.notes.join(' ')).toMatch(/INHERITS/);
  });

  it('judges the explicit destination by the 5-minute reading, like every other goal (d) value', async () => {
    const { answer, result } = await runGoals(
      {},
      ['interest_payout_wallet'],
      (h) => {
        const name = p7RoutingGoalName(h.ctx.qa.qaKey, 'd', 1).replaceAll(
          '-',
          ''
        );
        h.ctx.sleep = async (ms) => {
          if (ms !== GOAL_RECHECK_DELAY_MS) return;
          const goal = h.mock.sandbox.wallets.find((w) => w.name === name);
          if (goal) goal.payoutWalletId = h.state.mainWalletId ?? null;
        };
      }
    );
    expect(result.values.goal_d_payout_at_0m).toBe('business');
    expect(result.values.goal_d_payout_at_5m).toBe('main');
    expect(answer('goal_explicit_readback_names_payout_destination')).toBe(
      'no'
    );
    expect(answer('goal_d_interest_stays_in_goal')).toBe('no');
  });

  it('keeps the explicit destination read at once when the 5-minute recheck omits the payout field', async () => {
    const { answer, result } = await runGoals(
      {},
      ['interest_payout_wallet'],
      (h) => {
        h.ctx.sleep = async (ms) => {
          if (ms !== GOAL_RECHECK_DELAY_MS) return;
          const read = h.api.wallet.bind(h.api);
          h.api.wallet = async (id) => {
            const call = await read(id);
            if (call.data === null || typeof call.data !== 'object')
              return call;
            const data = { ...(call.data as Record<string, unknown>) };
            delete data.interest_payout_wallet;
            return { ...call, data };
          };
        };
      }
    );
    expect(result.values.goal_d_payout_at_0m).toBe('business');
    expect(result.values.goal_d_payout_at_5m).toBe('absent');
    expect(answer('goal_explicit_readback_names_payout_destination')).toBe(
      'yes'
    );
  });

  it('keeps the opted-out flag read at once when the 5-minute recheck omits it', async () => {
    const { answer, result } = await runGoals(
      {},
      ['interest_payout_wallet'],
      (h) => {
        h.ctx.sleep = async (ms) => {
          if (ms !== GOAL_RECHECK_DELAY_MS) return;
          // From now on readbacks show the payout but no accrual flag.
          const read = h.api.wallet.bind(h.api);
          h.api.wallet = async (id) => {
            const call = await read(id);
            if (call.data === null || typeof call.data !== 'object')
              return call;
            const data = { ...(call.data as Record<string, unknown>) };
            delete data.interest_enabled;
            delete data.enable_interest_accrual;
            return { ...call, data };
          };
        };
      }
    );
    expect(result.values.goal_b_interest_enabled_at_0m).toBe(false);
    expect(result.values.goal_b_interest_enabled_at_5m).toBeNull();
    expect(result.values.goal_b_payout_at_5m).toBe('null');
    expect(answer('goal_opted_out_reads_accrual_off')).toBe('yes');
  });

  it('keeps an opted-out flag a polled readback showed before the payout, at both readings', async () => {
    const { answer, result } = await runGoals(
      {},
      ['interest_payout_wallet'],
      (h) => {
        const original = h.api.wallet.bind(h.api);
        // Each phase's first read shows the flag but not yet the payout; later
        // reads show the payout but have dropped the flag.
        const lagging = () => {
          const reads = new Map<string, number>();
          h.api.wallet = async (id) => {
            const call = await original(id);
            reads.set(id, (reads.get(id) ?? 0) + 1);
            if (call.data === null || typeof call.data !== 'object')
              return call;
            const data = { ...(call.data as Record<string, unknown>) };
            if (reads.get(id) === 1) delete data.interest_payout_wallet;
            else {
              delete data.interest_enabled;
              delete data.enable_interest_accrual;
            }
            return { ...call, data };
          };
        };
        lagging();
        h.ctx.sleep = async (ms) => {
          if (ms === GOAL_RECHECK_DELAY_MS) lagging();
        };
      }
    );
    expect(result.values.goal_b_interest_enabled_at_0m).toBe(false);
    expect(result.values.goal_b_interest_enabled_at_5m).toBe(false);
    expect(result.values.goal_b_payout_at_0m).toBe('null');
    expect(result.values.goal_b_payout_at_5m).toBe('null');
    expect(answer('goal_opted_out_reads_accrual_off')).toBe('yes');
  });
});
