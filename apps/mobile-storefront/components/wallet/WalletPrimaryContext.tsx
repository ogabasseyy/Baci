import { createContext, useContext } from 'react';

/**
 * True only when the server explicitly says the customer's PiggyVest main
 * wallet is ready. Defaults to false, so any component rendered outside the
 * provider (or before a verdict) behaves exactly like the legacy wallet.
 * Lets WalletContent reach the contribution flow without threading a prop
 * through the savings progress modal.
 */
export const WalletPrimaryContext = createContext(false);

export function useWalletPrimaryReady(): boolean {
  return useContext(WalletPrimaryContext);
}
