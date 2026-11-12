import type {
  WalletPayAdapter,
  WalletPayOutcomeKind,
} from './wallet-pay.types';

// Outcomes after which a payment may still move or settle: the purchase
// keeps its key so the next tap resumes it instead of paying again.
const OPEN_OUTCOMES = new Set<WalletPayOutcomeKind>(['pending', 'review']);

// Module-level so a key survives the sheet closing and the screen
// remounting (the server recognises the purchase by this key). Cleared only
// once the purchase reaches an answer where no payment is left open.
const keys = new Map<string, string>();

export const walletPayPurchaseKeys = {
  /** The key for this purchase: the open one, or a fresh one. */
  keyFor(purchase: string, mint: () => string) {
    const open = keys.get(purchase);
    if (open) return open;
    const key = mint();
    keys.set(purchase, key);
    return key;
  },
  forget(purchase: string) {
    keys.delete(purchase);
  },
  /** Tests only. */
  reset() {
    keys.clear();
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
  const settle = () => {
    walletPayPurchaseKeys.forget(purchase);
    onSettled();
  };
  return {
    async start() {
      const answer = await adapter.start();
      if (answer.kind === 'outcome' && settles(answer.outcome.kind)) settle();
      return answer;
    },
    async verifyPin(operationId, pin) {
      const answer = await adapter.verifyPin(operationId, pin);
      if (answer.kind === 'outcome' && settles(answer.outcome.kind)) settle();
      return answer;
    },
    async pay(operationId, proof) {
      const answer = await adapter.pay(operationId, proof);
      if (
        answer.kind === 'delivered' ||
        (answer.kind === 'outcome' && settles(answer.outcome.kind))
      )
        settle();
      return answer;
    },
  };
}
