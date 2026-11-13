import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  WalletPayAdapter,
  WalletPayOutcomeKind,
} from './wallet-pay.types';

// Answers that prove nothing about a payment already sent (a lost session,
// a paused service, a dropped start): the purchase keeps its key so the next
// tap resumes the same payment instead of paying again.
const KEEP_OUTCOMES = new Set<WalletPayOutcomeKind>([
  'pending',
  'review',
  'sign_in',
  'unavailable',
  'not_started',
]);
// After a PIN, only a definite answer settles: delivered, refunded, short of
// money, or not completed. Anything else (an IMEI mismatch, a refusal) keeps
// the key, because the transfer may still be confirming.
const PAY_SETTLES = new Set<WalletPayOutcomeKind>([
  'refunded',
  'insufficient',
  'not_completed',
]);

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
  // A failed read throws (fail closed): an open key we can't see must never
  // be replaced by a new one, which could pay twice. Nothing is cached, so
  // the next attempt reads again. Only data that can't be parsed (it can
  // never be read back) counts as empty.
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  let parsed: unknown = null;
  try {
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

const FORGET_ATTEMPTS = 3;

/** True once saved. Every later save also carries an earlier removal. */
async function save(purchases: OpenPurchases) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(purchases));
    return true;
  } catch {
    return false;
  }
}

// Every read-modify-write runs one at a time, so two quick taps on a cold
// cache can never mint two keys for the same purchase.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export const walletPayPurchaseKeys = {
  /** The key for this purchase: the open one, or a fresh one (saved first). */
  keyFor(purchase: string, mint: () => string) {
    return serialized(async () => {
      const purchases = await load();
      const open = purchases[purchase];
      if (open) return open.key;
      const key = mint();
      purchases[purchase] = { key, at: Date.now() };
      // Nothing is sent until the new key is saved: a key that only lives in
      // memory could be lost on a restart while its payment is pending.
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(purchases));
      } catch (error) {
        delete purchases[purchase];
        throw error;
      }
      return key;
    });
  },
  forget(purchase: string) {
    return serialized(async () => {
      const purchases = await load();
      if (!(purchase in purchases)) return;
      delete purchases[purchase];
      // Retried: a removal that never reaches the phone would bring the old
      // key back after a restart (a replay of the finished purchase).
      for (let attempt = 0; attempt < FORGET_ATTEMPTS; attempt += 1)
        if (await save(purchases)) return;
    });
  },
  /** Tests only: drops the in-memory copy, as an app restart does. */
  resetMemory() {
    cache = null;
  },
};

/**
 * Wraps a product adapter so its purchase key is forgotten only when the
 * purchase is settled, and anything that proves nothing keeps it for the
 * next attempt. `onSettled` runs then too, e.g. to refresh the balance.
 * `stillOwner` is checked before every call: once the signed-in account has
 * changed, nothing more is sent for the old one (answered as sign in, which
 * keeps the key for that account).
 */
export function trackWalletPayPurchase<Result>(
  adapter: WalletPayAdapter<Result>,
  /** The purchase (or a getter, null until the adapter knows it). */
  purchase: string | (() => string | null),
  options: { onSettled: () => void; stillOwner: () => boolean }
): WalletPayAdapter<Result> {
  const settle = async () => {
    // The account changed while the call was out: the sheet drops this
    // answer, so the key stays. The old account's next try replays the same
    // request and gets the settled answer, never a second payment.
    if (!options.stillOwner()) return;
    const id = typeof purchase === 'string' ? purchase : purchase();
    if (id) await walletPayPurchaseKeys.forget(id);
    options.onSettled();
  };
  const switched = {
    kind: 'outcome' as const,
    outcome: { kind: 'sign_in' as const },
  };
  return {
    async start() {
      if (!options.stillOwner()) return switched;
      const answer = await adapter.start();
      if (
        answer.kind === 'delivered' ||
        (answer.kind === 'outcome' && !KEEP_OUTCOMES.has(answer.outcome.kind))
      )
        await settle();
      return answer;
    },
    async verifyPin(operationId, pin) {
      if (!options.stillOwner()) return switched;
      const answer = await adapter.verifyPin(operationId, pin);
      if (answer.kind === 'outcome' && !KEEP_OUTCOMES.has(answer.outcome.kind))
        await settle();
      return answer;
    },
    async pay(operationId, proof) {
      if (!options.stillOwner()) return switched;
      const answer = await adapter.pay(operationId, proof);
      // With a proof, a refusal ('failed', e.g. an IMEI mismatch) comes
      // before the transfer is sent, so it settles too; on an empty-proof
      // re-check it may come after, so the key stays.
      if (
        answer.kind === 'delivered' ||
        (answer.kind === 'outcome' &&
          (PAY_SETTLES.has(answer.outcome.kind) ||
            (proof !== '' && answer.outcome.kind === 'failed')))
      )
        await settle();
      return answer;
    },
  };
}
