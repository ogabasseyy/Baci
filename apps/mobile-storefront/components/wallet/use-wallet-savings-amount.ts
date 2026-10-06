import { useEffect, useState } from 'react';
import { normalizeWalletFundAmountParam } from '@/lib/normalize-wallet-fund-amount-param';

export function useWalletSavingsAmount(
  action: string | undefined,
  routeAmount: string | string[] | undefined
) {
  const normalizedAmount = normalizeWalletFundAmountParam(routeAmount);
  const [amount, setAmount] = useState(
    action === 'savings' ? normalizedAmount : ''
  );

  useEffect(() => {
    if (action === 'savings' && normalizedAmount) {
      setAmount(normalizedAmount);
    }
  }, [action, normalizedAmount]);

  return [amount, setAmount] as const;
}
