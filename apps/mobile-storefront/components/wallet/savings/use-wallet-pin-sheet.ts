import { useEffect, useRef, useState } from 'react';
import {
  fetchWalletPinStatus,
  submitWalletPin,
  verifyFundPin,
  verifyGoalActionPin,
} from '@/lib/wallet-pin-api';
import { WalletPinSchemas } from '@/schemas/wallet-pin';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import {
  pinCodeOf as codeOf,
  goalActionMessageOf,
  pinMessageOf as messageOf,
} from './wallet-pin-sheet-errors';

export type WalletPinStep =
  | 'loading'
  | 'unavailable'
  | 'confirm'
  | 'set'
  | 'reset'
  | 'enter';

type NewPinStep = 'set' | 'reset';

export const WALLET_PIN_UNAVAILABLE = 'Wallet PIN is unavailable right now';
const PIN_FORMAT = 'Enter 4 to 6 digits.';
const PIN_MISMATCH = 'The two PINs do not match.';
const PIN_SAVED = 'PIN saved. Enter it again to confirm this contribution.';
const PIN_SAVED_SHORT = 'PIN saved.';

/**
 * State for the wallet PIN sheet. The server decides the step: set a PIN only
 * for a primary customer with none (and a working PIN service), reset when it
 * asks for one, otherwise enter the PIN. When setting or resetting needs a
 * fresher sign-in, "Confirm it's you" comes first (step 'confirm'), and a
 * save the server still refuses for that reason comes back to it. A new PIN
 * then approves this request straight away. The PIN lives only in this state,
 * a ref kept across the confirm step, and the request body; it is cleared as
 * soon as it is used or the sheet closes.
 */
export function useWalletPinSheet({
  request,
  expectedUserId,
  onProof,
  onInvalid,
}: Pick<
  WalletPinSheetBinding,
  'request' | 'onProof' | 'expectedUserId' | 'onInvalid'
>) {
  const [step, setStep] = useState<WalletPinStep>('loading');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Where "Confirm it's you" leads, and a PIN already chosen when a save was
  // refused for an old sign-in (so the customer never types it again).
  const resumeStep = useRef<NewPinStep>('set');
  const pendingPin = useRef<string | null>(null);
  // Bumped every time the sheet opens, closes or switches request, so an
  // answer that arrives for an earlier one can tell it is stale.
  const generation = useRef(0);
  const operationId = request?.operationId ?? null;
  const goalId = request?.goalId ?? null;
  const amountKobo =
    request && 'amountKobo' in request ? request.amountKobo : null;
  const action = request?.action ?? 'fund';
  const merchantId = request?.merchantId ?? null;
  const isFund = Boolean(request && 'amountKobo' in request);
  const failureText = (failure: unknown) =>
    isFund ? messageOf(failure) : goalActionMessageOf(failure);

  const newPinStep = (kind: NewPinStep, confirmFirst: boolean) => {
    resumeStep.current = kind;
    setStep(confirmFirst ? 'confirm' : kind);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the whole request identity must restart the sheet, even though the effect body only reads the id and the user.
  useEffect(() => {
    generation.current += 1;
    pendingPin.current = null;
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
        const confirmFirst = status.signInConfirmationRequired === true;
        if (!status.primary || !status.available) setStep('unavailable');
        else if (status.resetRequired) newPinStep('reset', confirmFirst);
        else if (status.hasPin) setStep('enter');
        else newPinStep('set', confirmFirst);
      })
      .catch(() => {
        if (current) setStep('unavailable');
      });
    return () => {
      current = false;
    };
  }, [operationId, goalId, amountKobo, action, merchantId, expectedUserId]);

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

  // Checks a PIN for this request and hands the proof up. False when it
  // was refused (the step and error are already set).
  const approve = async (value: string, isCurrent: () => boolean) => {
    if (!request) return false;
    if (!request.merchantId) {
      setError(WALLET_PIN_UNAVAILABLE);
      return false;
    }
    try {
      const proof =
        'amountKobo' in request
          ? await verifyFundPin(
              {
                merchantId: request.merchantId,
                pin: value,
                goalId: request.goalId,
                operationId: request.operationId,
                amountKobo: request.amountKobo,
              },
              expectedUserId
            )
          : await verifyGoalActionPin(
              {
                merchantId: request.merchantId,
                pin: value,
                action: request.action,
                goalId: request.goalId,
                operationId: request.operationId,
              },
              expectedUserId
            );
      // The sheet was closed or re-opened while this check was in flight:
      // the proof belongs to a request nobody is waiting on any more.
      if (!isCurrent()) return false;
      setPin('');
      onProof(proof);
      return true;
    } catch (failure) {
      if (!isCurrent()) return false;
      setPin('');
      const code = codeOf(failure);
      if (
        onInvalid &&
        (code === 'CANCEL_OPERATION_INVALID' ||
          code === 'COMPLETE_OPERATION_INVALID')
      ) {
        onInvalid(messageOf(failure));
        return false;
      }
      if (code === 'PIN_NOT_SET') newPinStep('set', false);
      else if (code === 'PIN_RESET_REQUIRED') newPinStep('reset', false);
      setError(failureText(failure));
      return false;
    }
  };

  // Saves a new PIN, then uses it at once for this request: the customer
  // just typed it twice, so asking a third time adds nothing.
  const saveAndApprove = async (
    kind: NewPinStep,
    value: string,
    isCurrent: () => boolean
  ) => {
    try {
      await submitWalletPin(kind, value, expectedUserId);
    } catch (failure) {
      if (!isCurrent()) return;
      const code = codeOf(failure);
      if (code === 'REAUTHENTICATION_REQUIRED') {
        pendingPin.current = value;
        return newPinStep(kind, true);
      }
      if (code === 'PIN_ALREADY_SET') setStep('enter');
      else setError(failureText(failure));
      return;
    }
    if (!isCurrent()) return;
    setStep('enter');
    if (await approve(value, isCurrent)) return;
    if (isCurrent()) setNotice(isFund ? PIN_SAVED : PIN_SAVED_SHORT);
  };

  const submitNewPin = (kind: NewPinStep) =>
    guarded(async (isCurrent) => {
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      if (pin !== confirmPin) return setError(PIN_MISMATCH);
      const value = pin;
      setPin('');
      setConfirmPin('');
      await saveAndApprove(kind, value, isCurrent);
    });

  const submitEntry = () =>
    guarded(async (isCurrent) => {
      if (!request) return;
      if (!WalletPinSchemas.pin.safeParse(pin).success)
        return setError(PIN_FORMAT);
      setNotice(null);
      await approve(pin, isCurrent);
    });

  /** "Confirm it's you" succeeded: carry on where the customer was. */
  const identityConfirmed = () =>
    guarded(async (isCurrent) => {
      const kind = resumeStep.current;
      const value = pendingPin.current;
      pendingPin.current = null;
      if (!value) return setStep(kind);
      await saveAndApprove(kind, value, isCurrent);
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
    identityConfirmed,
  };
}
