import 'server-only';
import type { User } from '@supabase/supabase-js';
import { executeImeiLookup } from './execute-imei-lookup';
import { type ImeiLookupRow, mapExistingLookup } from './route-helpers';
import { startImeiWalletPayment } from './wallet-pay/start-imei-wallet-payment';

/**
 * A PiggyVest wallet payment whose start response was lost: the same pending
 * lookup goes back through the start step, which answers with the payment
 * already issued for it (the client needs its operation id for the PIN).
 */
export function continuesWalletPayment(
  body: { paymentMethod: 'store_credit' | 'piggyvest_wallet' },
  existing: { status: string }
) {
  return (
    body.paymentMethod === 'piggyvest_wallet' && existing.status === 'pending'
  );
}

/** The answer for a replayed Idempotency-Key, or null to carry on. */
export function replayFor(
  existing: ImeiLookupRow | null,
  body: { paymentMethod: 'store_credit' | 'piggyvest_wallet' },
  context: Parameters<typeof mapExistingLookup>[1]
) {
  if (!existing || continuesWalletPayment(body, existing)) return null;
  return mapExistingLookup(existing, context);
}

/**
 * Picks how an IMEI check is paid. 'store_credit' is the existing flow,
 * unchanged; 'piggyvest_wallet' only creates the lookup and asks for a
 * PIN-confirmed PiggyVest payment (see wallet-pay/).
 */
export async function runImeiLookup(
  paymentMethod: 'store_credit' | 'piggyvest_wallet',
  input: Parameters<typeof executeImeiLookup>[0] & { user: User }
) {
  if (paymentMethod === 'piggyvest_wallet')
    return await startImeiWalletPayment(input);
  const { user: _user, ...storeCredit } = input;
  return await executeImeiLookup(storeCredit);
}
