import { useEffect, useRef, useState } from 'react';
import type {
  PinProofRequest,
  PinProofRequester,
} from '@/lib/wallet-pin-proof';
import { useAuthStore } from '@/stores/auth-store';

export type WalletPinSheetBinding = {
  request: PinProofRequest | null;
  /** The account that opened the sheet; every PIN call is pinned to it. */
  expectedUserId?: string;
  onProof: (proof: string) => void;
  onCancel: () => void;
  /** The server says this operation is no longer valid: close, no proof. */
  onInvalid?: (message: string) => void;
};

/**
 * Lets a contribution flow wait for the customer's PIN: `requestProof` opens
 * the sheet and resolves with the single-use proof, or null when the sheet is
 * closed or the screen goes away. Only the proof leaves this hook.
 */
export function useWalletPinPrompt() {
  const [request, setRequest] = useState<PinProofRequest | null>(null);
  const userId = useAuthStore((state) => state.user?.id);
  const initiator = useRef<string | undefined>(undefined);
  const resolver = useRef<((proof: string | null) => void) | null>(null);
  const invalid = useRef<string | null>(null);
  useEffect(
    () => () => {
      resolver.current?.(null);
      resolver.current = null;
    },
    []
  );
  // A different signed-in account must never inherit this sheet or its waiter.
  useEffect(() => {
    if (resolver.current && initiator.current !== userId) {
      const resolve = resolver.current;
      resolver.current = null;
      setRequest(null);
      resolve(null);
    }
  }, [userId]);
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
      initiator.current = userId;
      invalid.current = null;
      setRequest(next);
    });
  const sheetProps: WalletPinSheetBinding = {
    request,
    expectedUserId: request ? initiator.current : undefined,
    onProof: settle,
    onCancel: () => settle(null),
    onInvalid: (message: string) => {
      invalid.current = message;
      settle(null);
    },
  };
  /** Why the last sheet closed without a proof, if the server invalidated it. */
  const takeInvalid = () => {
    const message = invalid.current;
    invalid.current = null;
    return message;
  };
  /** Closes the sheet and resolves the waiter with no proof. */
  const cancel = () => settle(null);
  return { requestProof, sheetProps, takeInvalid, cancel };
}
