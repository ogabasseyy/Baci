import { walletDataSchema } from './loose-schemas';
import type { ProofContext } from './proof-context';
import type { CallResult } from './provider-ops';
import { okData } from './read-rules';

export interface TerminalWatch {
  terminal: 'success' | 'failed' | 'timeout';
  polls: number;
  /** Distinct TSQ states in the order first seen (enum values and http_NNN). */
  statuses: string[];
  lastOk: CallResult | null;
}

const SUCCESS = new Set(['success', 'successful']);

export function statusOf(call: CallResult): string {
  const data = call.data;
  const status =
    data !== null && typeof data === 'object'
      ? (data as Record<string, unknown>).status
      : undefined;
  if (
    call.ok &&
    typeof status === 'string' &&
    /^[A-Za-z_-]{1,20}$/.test(status)
  )
    return status;
  return call.httpStatus === null ? 'network_error' : `http_${call.httpStatus}`;
}

/** Polls TSQ on our own reference until it is terminal or the budget runs out. */
export async function awaitTerminal(
  ctx: ProofContext,
  reference: string,
  walletId: string | undefined
): Promise<TerminalWatch> {
  const statuses: string[] = [];
  let lastOk: CallResult | null = null;
  for (let poll = 1; poll <= ctx.maxPolls; poll += 1) {
    const call = await ctx.api.verify(reference, walletId);
    const status = statusOf(call);
    if (!statuses.includes(status)) statuses.push(status);
    if (call.ok) lastOk = call;
    if (SUCCESS.has(status))
      return { terminal: 'success', polls: poll, statuses, lastOk };
    if (status === 'failed')
      return { terminal: 'failed', polls: poll, statuses, lastOk };
    await ctx.sleep(ctx.pollIntervalMs);
  }
  return { terminal: 'timeout', polls: ctx.maxPolls, statuses, lastOk };
}

export interface WalletReading {
  balance: number | null;
  withdrawalCount: number | null;
}

export async function readWallet(
  ctx: ProofContext,
  walletId: string
): Promise<WalletReading> {
  const call = await ctx.api.wallet(walletId);
  // A failed read may keep a schema-valid body: only a successful one counts.
  const parsed = walletDataSchema.safeParse(okData(call));
  return {
    balance: parsed.success ? parsed.data.balance : null,
    withdrawalCount: parsed.success
      ? (parsed.data.withdrawal_count ?? null)
      : null,
  };
}

export async function readAllWallets(
  ctx: ProofContext
): Promise<Map<string, WalletReading>> {
  const readings = new Map<string, WalletReading>();
  for (const wallet of ctx.state.wallets) {
    readings.set(wallet.id, await readWallet(ctx, wallet.id));
  }
  return readings;
}

export const delta = (
  before: number | null,
  after: number | null
): number | null => (before === null || after === null ? null : after - before);
