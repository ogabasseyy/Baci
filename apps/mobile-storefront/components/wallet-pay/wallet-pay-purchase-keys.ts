import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  WalletPayAdapter,
  WalletPayOutcomeKind,
} from './wallet-pay.types';

// Outcomes after which a payment may still move or settle: the purchase
// keeps its key so the next tap resumes it instead of paying again.
const OPEN_OUTCOMES = new Set<WalletPayOutcomeKind>(['pending', 'review']);

const STORAGE_KEY = 'baci.walletPay.openPurchases.v1';
// The server releases or refunds anything older long before this.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type OpenPurchases = Record<string, { key: string; at: number }>;

// Saved on the phone so a key survives the sheet closing, the screen
// remounting and the app restarting (the server recognises the purchase by
// this key). Cleared only once the purchase reaches an answer where no
// payment is left open. Callers scope `purchase` to the signed-in account.
let cache: OpenPurchases | null = null;

async function load(): Promise<OpenPurchases> {
  if (cache) return cache;
  // Unreadable storage counts as empty: never block a payment on it.
  let parsed: unknown = null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const now = Date.now();
  cache = {};
  if (parsed && typeof parsed === 'object')
    for (const [purchase, entry] of Object.entries(parsed)) {
      const { key, at } = (entry ?? {}) as { key?: unknown; at?: unknown };
      if (
        typeof key === 'string' &&
        typeof at === 'number' &&
        now - at < MAX_AGE_MS
      )
        cache[purchase] = { key, at };
    }
  return cache;
}

async function save(purchases: OpenPurchases) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(purchases));
  } catch {
    // Kept in memory for this session even when the phone can't save it.
  }
}

export const walletPayPurchaseKeys = {
  /** The key for this purchase: the open one, or a fresh one (saved first). */
  async keyFor(purchase: string, mint: () => string) {
    const purchases = await load();
    const open = purchases[purchase];
    if (open) return open.key;
    const key = mint();
    purchases[purchase] = { key, at: Date.now() };
    await save(purchases);
    return key;
  },
  async forget(purchase: string) {
    const purchases = await load();
    if (!(purchase in purchases)) return;
    delete purchases[purchase];
    await save(purchases);
  },
  /** Tests only: drops the in-memory copy, as an app restart does. */
  resetMemory() {
    cache = null;
  },
};

const settles = (kind: WalletPayOutcomeKind) => !OPEN_OUTCOMES.has(kind);

/**
 * Wraps a product adapter so its purchase key is forgotten only when the
 * purchase is settled (delivered, refunded, or nothing moved), and a lost or
 * pending answer keeps it for the next attempt. `onSettled` runs then too,
 * e.g. to refresh the wallet balance.
 */
export function trackWalletPayPurchase<Result>(
  adapter: WalletPayAdapter<Result>,
  purchase: string,
  onSettled: () => void
): WalletPayAdapter<Result> {
  const settle = async () => {
    await walletPayPurchaseKeys.forget(purchase);
    onSettled();
  };
  return {
    async start() {
      const answer = await adapter.start();
      if (answer.kind === 'outcome' && settles(answer.outcome.kind))
        await settle();
      return answer;
    },
    async verifyPin(operationId, pin) {
      const answer = await adapter.verifyPin(operationId, pin);
      if (answer.kind === 'outcome' && settles(answer.outcome.kind))
        await settle();
      return answer;
    },
    async pay(operationId, proof) {
      const answer = await adapter.pay(operationId, proof);
      if (
        answer.kind === 'delivered' ||
        (answer.kind === 'outcome' && settles(answer.outcome.kind))
      )
        await settle();
      return answer;
    },
  };
}
