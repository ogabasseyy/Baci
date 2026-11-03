import { useEffect, useRef, useState } from 'react';
import type {
  PinProofRequest,
  PinProofRequester,
} from '@/lib/wallet-pin-proof';

export type WalletPinSheetBinding = {
  request: PinProofRequest | null;
  onProof: (proof: string) => void;
  onCancel: () => void;
};

/**
 * Lets a contribution flow wait for the customer's PIN: `requestProof` opens
 * the sheet and resolves with the single-use proof, or null when the sheet is
 * closed or the screen goes away. Only the proof leaves this hook.
 */
export function useWalletPinPrompt() {
  const [request, setRequest] = useState<PinProofRequest | null>(null);
  const resolver = useRef<((proof: string | null) => void) | null>(null);
  useEffect(
    () => () => {
      resolver.current?.(null);
      resolver.current = null;
    },
    []
  );
  const settle = (proof: string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(proof);
  };
  const requestProof: PinProofRequester = (next) =>
    new Promise<string | null>((resolve) => {
      resolver.current?.(null);
      resolver.current = resolve;
      setRequest(next);
    });
  const sheetProps: WalletPinSheetBinding = {
    request,
    onProof: settle,
    onCancel: () => settle(null),
  };
  return { requestProof, sheetProps };
}
