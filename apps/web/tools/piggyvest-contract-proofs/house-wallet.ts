import { MUTATION_CAPABLE_MODES } from './constants';
import type { ProofContext } from './proof-context';
import { recordOf } from './read-rules';

/**
 * The operator-configured business sandbox wallet (PVB_PROOF_BUSINESS_WALLET_ID)
 * stands in for Ogabassey's Collection ("house") wallet in proofs 3 and 8.
 * It may be funded or used as a transfer source only after a successful read
 * shows it is bound to NO API customer (an explicit api_customer_id: null; a
 * readback without the key is treated as unread): a customer's wallet named there by
 * mistake (including the QA customer's own) is refused, and an unreadable one
 * fails closed. Read-only mode reads the binding but authorizes nothing.
 */

export type HouseBinding =
  | 'unbound'
  | 'bound'
  | 'qa_wallet'
  | 'unread'
  | 'not_configured';

export interface HouseAdmission {
  /** Set only when the wallet is admitted for mutations in this run. */
  walletId: string | null;
  binding: HouseBinding;
}

const REASONS: Record<Exclude<HouseBinding, 'unbound'>, string> = {
  bound:
    'the configured business wallet is bound to an API customer, so it is not used as the house wallet',
  qa_wallet:
    "the configured business wallet is one of the QA customer's own wallets",
  unread:
    'the configured business wallet could not be read, or its readback did not report an explicit customer binding',
  not_configured:
    'no business sandbox wallet configured (set PVB_PROOF_BUSINESS_WALLET_ID)',
};

export function houseRefusalReason(admission: HouseAdmission): string {
  if (admission.binding === 'unbound')
    return 'house-wallet steps need --live-sandbox-mutations';
  return REASONS[admission.binding];
}

export async function admitHouseWallet(
  ctx: ProofContext
): Promise<HouseAdmission> {
  const { state, businessWalletId: id, api, mode, redactor } = ctx;
  if (state.houseWalletId)
    return { walletId: state.houseWalletId, binding: 'unbound' };
  if (!id) return { walletId: null, binding: 'not_configured' };
  redactor.register('W', id);
  if (state.wallets.some((wallet) => wallet.id === id))
    return { walletId: null, binding: 'qa_wallet' };
  const record = recordOf(await api.wallet(id));
  if (!record || record.id !== id) return { walletId: null, binding: 'unread' };
  // Unbound needs the same explicit proof as ownership: only a present,
  // explicit null admits the wallet; an absent key proves nothing.
  if (!Object.hasOwn(record, 'api_customer_id'))
    return { walletId: null, binding: 'unread' };
  const owner = record.api_customer_id;
  if (typeof owner === 'string' && owner !== '')
    return { walletId: null, binding: 'bound' };
  if (owner !== null) return { walletId: null, binding: 'unread' };
  if (!MUTATION_CAPABLE_MODES.includes(mode))
    return { walletId: null, binding: 'unbound' };
  state.houseWalletId = id;
  state.authorized.add(id);
  return { walletId: id, binding: 'unbound' };
}
