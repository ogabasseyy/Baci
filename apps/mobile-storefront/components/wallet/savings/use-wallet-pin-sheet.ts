import { useEffect, useRef, useState } from 'react';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
} from '@/lib/wallet-pin-api';
import { WalletPinSchemas } from '@/schemas/wallet-pin';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';

export type WalletPinStep =
  | 'loading'
  | 'unavailable'
  | 'set'
  | 'reset'
  | 'enter';

export const WALLET_PIN_UNAVAILABLE = 'Wallet PIN is unavailable right now';
const PIN_FORMAT = 'Enter 4 to 6 digits.';
const PIN_MISMATCH = 'The two PINs do not match.';
const PIN_SAVED = 'PIN saved. Enter it again to confirm this contribution.';
const FALLBACK_ERROR = 'Something went wrong. Please try again.';

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : FALLBACK_ERROR;
}

function codeOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

/**
 * State for the wallet PIN sheet. The server decides the step: set a PIN only
 * for a primary customer with none (and a working PIN service), reset when it
 * asks for one, otherwise enter the PIN. The PIN lives only in this state and
 * in the request body; it is cleared as soon as it is used or the sheet closes.
 */
export function useWalletPinSheet({
  request,
  onProof,
}: Pick<WalletPinSheetBinding, 'request' | 'onProof'>) {
  const [step, setStep] = useState<WalletPinStep>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const operationId = request?.operationId ?? null;

  useEffect(() => {
    setPin('');
    setConfirmPin('');
    setError(null);
    setNotice(null);
    setBusy(false);
    busyRef.current = false;
    setStep('loading');
    if (!operationId) return;
    let current = true;
    fetchWalletPinStatus()
      .then((status) => {
        if (!current) return;
        if (!status.primary || !status.available) setStep('unavailable');
        else if (status.resetRequired) setStep('reset');
        else setStep(status.hasPin ? 'enter' : 'set');
      })
      .catch(() => {
        if (current) setStep('unavailable');
      });
    return () => {
      current = false;
    };
  }, [operationId]);

  const guarded = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const submitNewPin = (kind: 'set' | 'reset') =>
    guarded(async () => {
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      if (pin !== confirmPin) return setError(PIN_MISMATCH);
      try {
        await submitWalletPin(kind, pin);
        setNotice(PIN_SAVED);
        setStep('enter');
      } catch (failure) {
        if (codeOf(failure) === 'PIN_ALREADY_SET') setStep('enter');
        else setError(messageOf(failure));
      } finally {
        setPin('');
        setConfirmPin('');
      }
    });

  const submitEntry = () =>
    guarded(async () => {
      if (!request) return;
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      if (!request.merchantId) return setError(WALLET_PIN_UNAVAILABLE);
      setNotice(null);
      try {
        const proof = await verifyFundPin({
          merchantId: request.merchantId,
          pin,
          goalId: request.goalId,
          operationId: request.operationId,
          amountKobo: request.amountKobo,
        });
        setPin('');
        onProof(proof);
      } catch (failure) {
        setPin('');
        const code = codeOf(failure);
        if (code === 'PIN_NOT_SET') setStep('set');
        else if (code === 'PIN_RESET_REQUIRED') setStep('reset');
        setError(messageOf(failure));
      }
    });

  return {
    step,
    pin,
    confirmPin,
    error,
    notice,
    busy,
    setPin: (value: string) => setPin(value.replace(/[^0-9]/g, '').slice(0, 6)),
    setConfirmPin: (value: string) =>
      setConfirmPin(value.replace(/[^0-9]/g, '').slice(0, 6)),
    submit: () => {
      if (step === 'enter') return submitEntry();
      if (step === 'set' || step === 'reset') return submitNewPin(step);
      return Promise.resolve();
    },
  };
}
