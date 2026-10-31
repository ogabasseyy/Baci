import { useRef, useState } from 'react';
import type {
  OrderGiglQuote,
  OrderGiglQuoteResult,
} from '@/lib/order-gigl-shipping';
import {
  type OrderGiglWalletState,
  toOrderGiglWalletState,
} from '@/lib/order-gigl-shipping-state';

/**
 * The GIG panel's quote and wallet view, mirrored in refs for async callbacks.
 * A bound quote remembers the signature of the stored address it was priced
 * from, so the order refetch after an address save can keep it.
 */
export function useOrderGiglQuoteState() {
  const [quote, setQuoteState] = useState<OrderGiglQuote | null>(null);
  const quoteRef = useRef<OrderGiglQuote | null>(null);
  const [wallet, setWalletState] = useState<OrderGiglWalletState | null>(null);
  const walletRef = useRef<OrderGiglWalletState | null>(null);
  const quoteBoundRef = useRef(false);
  const boundSignatureRef = useRef<string | null>(null);
  quoteRef.current = quote;

  const setWallet = (next: OrderGiglWalletState | null) => {
    setWalletState(next);
    walletRef.current = next;
  };
  const setQuote = (
    next: OrderGiglQuote | null,
    boundSignature: string | null
  ) => {
    setQuoteState(next);
    quoteRef.current = next;
    quoteBoundRef.current = boundSignature !== null;
    boundSignatureRef.current = boundSignature;
  };

  return {
    /** A null signature applies an unbound (preview) quote. */
    applyQuote: (
      result: OrderGiglQuoteResult,
      boundSignature: string | null
    ) => {
      setQuote(result.quote, boundSignature);
      setWallet(toOrderGiglWalletState(result));
    },
    invalidateQuote: () => {
      setQuote(null, null);
      setWallet(null);
    },
    isBoundTo: (signature: string) =>
      quoteBoundRef.current && boundSignatureRef.current === signature,
    quote,
    quoteBoundRef,
    quoteRef,
    setWallet,
    wallet,
    walletRef,
  };
}
