/**
 * Wallet-row copy for utility payments. PiggyVest customers pay from
 * store credit, so every state names it that way; others keep "Wallet".
 */
export function getUtilityWalletCopy(storeCredit: boolean) {
  if (storeCredit) {
    return {
      checking: 'Checking store credit…',
      checkingLabel: 'Store credit. Checking store credit',
      pay: 'Pay with store credit',
      title: 'Store credit',
      unavailable: 'Store credit unavailable',
      unavailableBody: 'Could not load your store credit. Please try again.',
      unavailableLabel:
        'Store credit unavailable. Could not load your store credit',
    };
  }
  return {
    checking: 'Checking wallet balance…',
    checkingLabel: 'Wallet. Checking wallet balance',
    pay: 'Pay with wallet',
    title: 'Wallet',
    unavailable: 'Wallet unavailable',
    unavailableBody: 'Could not load your wallet balance. Please try again.',
    unavailableLabel: 'Wallet unavailable. Could not load your wallet balance',
  };
}
