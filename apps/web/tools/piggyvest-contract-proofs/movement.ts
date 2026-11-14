import { readWallet, type SettledWallets, settledWallets } from './poll';
import type { ProofContext } from './proof-context';

/**
 * S8 verdict rule, part (b): a measurement taken after a transfer counts only
 * once the readbacks SHOW the movement. A balance that lags the terminal
 * status looks "settled" when it simply has not changed yet, so a stale,
 * unchanged balance is never treated as a result.
 */

export interface MovementWatch extends SettledWallets {
  /** Every wallet in `mustMove` showed a balance different from its baseline. */
  moved: boolean;
}

/**
 * Polls the `mustMove` wallets within the polling budget until each balance
 * differs from its baseline. If one never does, nothing is published
 * (`moved: false`, `settled: false`). Once they moved, the whole `walletIds`
 * batch is read until it stops moving, as `settledWallets` does.
 */
export async function settledAfterMovement(
  ctx: ProofContext,
  walletIds: readonly string[],
  baseline: SettledWallets,
  mustMove: readonly string[]
): Promise<MovementWatch> {
  const before = (id: string) => baseline.readings.get(id)?.balance ?? null;
  let moved = false;
  for (let poll = 0; poll <= ctx.maxPolls && !moved; poll += 1) {
    if (poll > 0) await ctx.sleep(ctx.pollIntervalMs);
    const flags: boolean[] = [];
    for (const id of mustMove) {
      const now = (await readWallet(ctx, id)).balance;
      const was = before(id);
      flags.push(now !== null && was !== null && now !== was);
    }
    moved = mustMove.length > 0 && flags.every(Boolean);
  }
  if (!moved) return { readings: new Map(), settled: false, moved: false };
  return { ...(await settledWallets(ctx, walletIds)), moved: true };
}
