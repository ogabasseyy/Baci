'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { asRoute } from '@/lib/routes';
import type { CryptoChain, CryptoCurrency } from '../types';
import {
  type JuicywayPendingOrder,
  useJuicywayPayment,
} from './use-juicyway-payment';

const CRYPTO_CHAIN_SUPPORT: Record<CryptoCurrency, CryptoChain[]> = {
  USDT: ['TRX', 'ETH'],
  USDC: ['ETH', 'MATIC', 'AVAXC'],
};

interface UseCheckoutCryptoSessionOptions {
  merchantId?: string | null;
  clearCheckoutSession: () => void;
  clearPendingCheckoutOrder: () => void;
  clearCart: () => void;
  getHref: (path: string) => string;
  isOrderInFlightRef: { current: boolean };
}

/** Owns the checkout crypto selector interaction and its Juicyway lifecycle. */
export function useCheckoutCryptoSession({
  merchantId,
  clearCheckoutSession,
  clearPendingCheckoutOrder,
  clearCart,
  getHref,
  isOrderInFlightRef,
}: UseCheckoutCryptoSessionOptions) {
  const router = useRouter();
  const [showCryptoSelector, setShowCryptoSelector] = useState(false);
  const [selectedCryptoChain, setSelectedCryptoChain] =
    useState<CryptoChain>('TRX');
  const [selectedCryptoCurrency, setSelectedCryptoCurrency] =
    useState<CryptoCurrency>('USDT');
  const [pendingCryptoOrder, setPendingCryptoOrder] =
    useState<JuicywayPendingOrder | null>(null);

  const juicyway = useJuicywayPayment({
    merchantId: merchantId ?? undefined,
    pendingCryptoOrder,
    selectedCryptoChain,
    selectedCryptoCurrency,
    setShowCryptoSelector,
    clearCheckoutSession,
    clearPendingCheckoutOrder,
    clearCart,
    routerPush: (url) => router.push(asRoute(url)),
    getHref,
  });

  const changeCurrency = (currency: CryptoCurrency) => {
    juicyway.cancelCryptoInitialization();
    setSelectedCryptoCurrency(currency);
    const supportedChains = CRYPTO_CHAIN_SUPPORT[currency];
    if (!supportedChains.includes(selectedCryptoChain)) {
      setSelectedCryptoChain(supportedChains[0]);
    }
  };

  const changeChain = (chain: CryptoChain) => {
    juicyway.cancelCryptoInitialization();
    setSelectedCryptoChain(chain);
  };

  const closeSelector = () => {
    juicyway.cancelCryptoInitialization();
    setShowCryptoSelector(false);
    setPendingCryptoOrder(null);
    isOrderInFlightRef.current = false;
  };

  return {
    ...juicyway,
    pendingCryptoOrder,
    setPendingCryptoOrder,
    showCryptoSelector,
    setShowCryptoSelector,
    selectedCryptoChain,
    selectedCryptoCurrency,
    supportedChains: CRYPTO_CHAIN_SUPPORT[selectedCryptoCurrency],
    changeCurrency,
    changeChain,
    closeSelector,
  };
}
