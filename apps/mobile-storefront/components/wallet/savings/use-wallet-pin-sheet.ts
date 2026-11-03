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
  expectedUserId,
  onProof,
}: Pick<WalletPinSheetBinding, 'request' | 'onProof' | 'expectedUserId'>) {
  const [step, setStep] = useState<WalletPinStep>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Bumped every time the sheet opens, closes or switches request, so an
  // answer that arrives for an earlier one can tell it is stale.
  const generation = useRef(0);
  const operationId = request?.operationId ?? null;
  const goalId = request?.goalId ?? null;
  const amountKobo = request?.amountKobo ?? null;
  const merchantId = request?.merchantId ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the whole request identity must restart the sheet, even though the effect body only reads the id and the user.
  useEffect(() => {
    generation.current += 1;
    setPin('');
    setConfirmPin('');
    setError(null);
    setNotice(null);
    setBusy(false);
    busyRef.current = false;
    setStep('loading');
    if (!operationId) return;
    let current = true;
    fetchWalletPinStatus(expectedUserId)
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
  }, [operationId, goalId, amountKobo, merchantId, expectedUserId]);

  const guarded = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    const started = generation.current;
    const isCurrent = () => generation.current === started;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work(isCurrent);
    } finally {
      // A stale run must not clear the busy state of the request now shown.
      if (isCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const submitNewPin = (kind: 'set' | 'reset') =>
    guarded(async (isCurrent) => {
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      if (pin !== confirmPin) return setError(PIN_MISMATCH);
      try {
        await submitWalletPin(kind, pin, expectedUserId);
        if (!isCurrent()) return;
        setNotice(PIN_SAVED);
        setStep('enter');
      } catch (failure) {
        if (!isCurrent()) return;
        if (codeOf(failure) === 'PIN_ALREADY_SET') setStep('enter');
        else setError(messageOf(failure));
      } finally {
        if (isCurrent()) {
          setPin('');
          setConfirmPin('');
        }
      }
    });

  const submitEntry = () =>
    guarded(async (isCurrent) => {
      if (!request) return;
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      if (!request.merchantId) return setError(WALLET_PIN_UNAVAILABLE);
      setNotice(null);
      try {
        const proof = await verifyFundPin(
          {
            merchantId: request.merchantId,
            pin,
            goalId: request.goalId,
            operationId: request.operationId,
            amountKobo: request.amountKobo,
          },
          expectedUserId
        );
        // The sheet was closed or re-opened while this check was in flight:
        // the proof belongs to a request nobody is waiting on any more.
        if (!isCurrent()) return;
        setPin('');
        onProof(proof);
      } catch (failure) {
        if (!isCurrent()) return;
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
