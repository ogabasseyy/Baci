import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
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
// How long unreadable saved data refuses wallet pay before it is cleared.
// Readable keys never age out: a payment under review can stay open for a
// person to decide, and dropping its key would let a second payment start
// (Codex P1). A key is removed only once its purchase settles.
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
  // the next attempt reads again.
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed = raw ? parseSaved(raw) : null;
  if (parsed === UNREADABLE) await quarantine();
  cache = {};
  if (parsed && typeof parsed === 'object')
    for (const [purchase, entry] of Object.entries(parsed)) {
      const { key, at } = (entry ?? {}) as { key?: unknown; at?: unknown };
      if (typeof key === 'string' && typeof at === 'number')
        cache[purchase] = { key, at };
    }
  return cache;
}

const UNREADABLE = Symbol('unreadable');
const CORRUPT_KEY = `${STORAGE_KEY}.corruptSince`;

function parseSaved(raw: string): unknown {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return UNREADABLE;
    // One malformed entry may be an open key: the whole store is unreadable
    // (quarantined), never rebuilt without it (Codex P2).
    for (const entry of Object.values(parsed)) {
      const { key, at } = (entry ?? {}) as { key?: unknown; at?: unknown };
      if (typeof key !== 'string' || key === '' || typeof at !== 'number')
        return UNREADABLE;
    }
    return parsed;
  } catch {
    return UNREADABLE;
  }
}

/**
 * Saved data that can't be parsed may hide an open key, so it is never read
 * as empty: wallet pay stays refused (throws) for as long as any key in it
 * could still be open, then the data is cleared. A customer is never locked
 * out for good, and no open key is replaced while it might still pay.
 */
async function quarantine(): Promise<never | undefined> {
  const since = Number(await AsyncStorage.getItem(CORRUPT_KEY));
  const now = Date.now();
  if (!since) {
    await AsyncStorage.setItem(CORRUPT_KEY, String(now));
    throw new Error('Saved wallet payments are unreadable');
  }
  if (now - since < MAX_AGE_MS)
    throw new Error('Saved wallet payments are unreadable');
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(CORRUPT_KEY);
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
const WEB_LOCK_NAME = 'baci:wallet-pay-keys/v1';
type WebLocks = {
  request: (name: string, callback: () => Promise<unknown>) => Promise<unknown>;
};

/**
 * On the web every tab has its own memory but shares storage, so two tabs
 * could each mint a key for the same purchase (two payable requests). There
 * the work runs under a browser-wide lock and re-reads storage inside it; a
 * browser without such a lock refuses wallet pay (fail closed) rather than
 * risk it. Native apps run one JavaScript runtime: the queue is enough.
 */
function acrossTabs<T>(work: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'web') return work();
  const locks = (globalThis.navigator as { locks?: WebLocks } | undefined)
    ?.locks;
  if (!locks?.request)
    return Promise.reject(new Error('Wallet pay keys need a tab lock'));
  return locks.request(WEB_LOCK_NAME, async () => {
    cache = null;
    return await work();
  }) as Promise<T>;
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const guarded = () => acrossTabs(work);
  const next = queue.then(guarded, guarded);
  queue = next.catch(() => undefined);
  return next;
}

export const walletPayPurchaseKeys = {
  /** Whether a key is kept for this purchase (a peek: never mints). */
  has(purchase: string) {
    return serialized(async () => purchase in (await load()));
  },
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
  /**
   * Drops this purchase's key. With `onlyKey`, only that exact key: another
   * tab may have settled this purchase and started a newer check under a new
   * key, which a late answer here must never delete (Codex P1).
   */
  forget(purchase: string, onlyKey?: string) {
    return serialized(async () => {
      const purchases = await load();
      if (!(purchase in purchases)) return;
      if (onlyKey !== undefined && purchases[purchase]?.key !== onlyKey) return;
      delete purchases[purchase];
      // Retried: a removal that never reaches the phone would bring the old
      // key back after a restart (a replay of the finished purchase).
      for (let attempt = 0; attempt < FORGET_ATTEMPTS; attempt += 1)
        if (await save(purchases)) return;
    });
  },
  /**
   * Retires a settled purchase's key, but only that key, and puts it back if
   * the answer was dropped meanwhile (the sheet closed during the storage
   * work, so nothing consumed the delivered answer): the next try then
   * replays it instead of paying a new lookup (Codex P2).
   */
  retire(purchase: string, key: string, stillWanted: () => boolean) {
    return serialized(async () => {
      const purchases = await load();
      if (purchases[purchase]?.key !== key) return;
      const entry = purchases[purchase];
      delete purchases[purchase];
      for (let attempt = 0; attempt < FORGET_ATTEMPTS; attempt += 1)
        if (await save(purchases)) break;
      if (stillWanted() || purchases[purchase]) return;
      purchases[purchase] = entry;
      await save(purchases);
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
  options: {
    onSettled: () => void;
    stillOwner: () => boolean;
    /** False once the sheet dropped this purchase (closed or reopened). */
    stillWanted?: () => boolean;
    /** The idempotency key this attempt used: only it is ever retired. */
    key?: () => string | null;
  }
): WalletPayAdapter<Result> {
  const settle = async () => {
    // The account changed while the call was out: the sheet drops this
    // answer, so the key stays. The old account's next try replays the same
    // request and gets the settled answer, never a second payment.
    if (!options.stillOwner()) return;
    // The sheet was closed while the call was out and drops its answer
    // (e.g. a replayed delivered start): keep the key so the next try
    // replays it instead of paying again.
    if (options.stillWanted && !options.stillWanted()) return;
    const id = typeof purchase === 'string' ? purchase : purchase();
    // A storage failure never hides the settled answer (Muse): the key just
    // stays, and the next try replays the same settled request.
    const key = options.key?.() ?? null;
    if (id && key)
      await walletPayPurchaseKeys
        .retire(
          id,
          key,
          () =>
            options.stillOwner() &&
            (options.stillWanted ? options.stillWanted() : true)
        )
        .catch(() => undefined);
    else if (id) await walletPayPurchaseKeys.forget(id).catch(() => undefined);
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
      // A price refusal ('failed', price_changed) settles too: it answers a
      // payment only issued (no PIN was asked, nothing moved, it expires
      // unpaid). Keeping its key replayed that same old price forever, so
      // "start again to see the new price" could never reach it (Muse).
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
