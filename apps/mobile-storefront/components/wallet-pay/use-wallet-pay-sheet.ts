import { useEffect, useRef, useState } from 'react';
import type {
  WalletPayAdapter,
  WalletPayOutcome,
  WalletPayPayAnswer,
} from './wallet-pay.types';

export type WalletPayStep =
  | 'closed'
  | 'starting'
  | 'enter'
  | 'paying'
  | 'outcome';

/** How long to wait before checking on a payment PiggyVest is confirming. */
export const WALLET_PAY_RECHECK_MS = 3_000;
/** Automatic checks before the customer is left to tap "Check again". */
export const WALLET_PAY_AUTO_RECHECKS = 5;

const PIN_FORMAT = 'Enter 4 to 6 digits.';

/**
 * State for paying one purchase from the PiggyVest wallet: start (the server
 * issues the payment), PIN, pay once, then either the delivered result or a
 * calm outcome. An unknown answer is 'pending' and is re-checked with an empty
 * proof, which never sends money again. The PIN lives only in this state and
 * the verify body, and is cleared as soon as it is used or the sheet closes.
 */
export function useWalletPaySheet<Result>({
  onDelivered,
}: {
  onDelivered: (result: Result) => void;
}) {
  const [step, setStep] = useState<WalletPayStep>('closed');
  const [pin, setPinState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<WalletPayOutcome | null>(null);
  const [amountKobo, setAmountKobo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [rechecks, setRechecks] = useState(0);
  const adapter = useRef<WalletPayAdapter<Result> | null>(null);
  const operationId = useRef<string | null>(null);
  // Bumped on every open and close: a late answer for an older sheet is
  // dropped instead of changing the one on screen.
  const generation = useRef(0);

  const current = (mine: number) => mine === generation.current;

  const finish = (answer: WalletPayPayAnswer<Result>) => {
    if (answer.kind === 'delivered') {
      close();
      onDelivered(answer.result);
      return;
    }
    if (answer.kind === 'pin_again') {
      setError(answer.message);
      setStep('enter');
      return;
    }
    setOutcome(answer.outcome);
    setStep('outcome');
  };

  // Network errors after a PIN is spent are unknowns, never failures.
  const pay = async (proof: string) => {
    const mine = generation.current;
    const id = operationId.current;
    const active = adapter.current;
    if (!id || !active) return;
    setStep('paying');
    const answer = await active.pay(id, proof).catch(
      (): WalletPayPayAnswer<Result> => ({
        kind: 'outcome',
        outcome: { kind: 'pending' },
      })
    );
    if (current(mine)) finish(answer);
  };

  const open = async (next: WalletPayAdapter<Result>) => {
    generation.current += 1;
    const mine = generation.current;
    adapter.current = next;
    operationId.current = null;
    setPinState('');
    setError(null);
    setOutcome(null);
    setAmountKobo(null);
    setRechecks(0);
    setStep('starting');
    const started = await next.start().catch(() => ({
      kind: 'outcome' as const,
      outcome: { kind: 'failed' as const },
    }));
    if (!current(mine)) return;
    if (started.kind === 'outcome') {
      setOutcome(started.outcome);
      setStep('outcome');
      return;
    }
    operationId.current = started.operationId;
    setAmountKobo(started.amountKobo);
    if (started.kind === 'recheck') await pay('');
    else setStep('enter');
  };

  const submit = async () => {
    const id = operationId.current;
    const active = adapter.current;
    if (busy || step !== 'enter' || !id || !active) return;
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError(PIN_FORMAT);
      return;
    }
    const mine = generation.current;
    const typed = pin;
    setPinState('');
    setError(null);
    setBusy(true);
    const answer = await active.verifyPin(id, typed).catch(() => ({
      kind: 'retry' as const,
      message: 'Could not check your PIN. Please try again.',
    }));
    if (!current(mine)) return;
    setBusy(false);
    if (answer.kind === 'retry') return setError(answer.message);
    if (answer.kind === 'outcome') {
      setOutcome(answer.outcome);
      return setStep('outcome');
    }
    await pay(answer.proof);
  };

  const recheck = async () => {
    setRechecks((count) => count + 1);
    await pay('');
  };

  const close = () => {
    generation.current += 1;
    adapter.current = null;
    operationId.current = null;
    setPinState('');
    setError(null);
    setBusy(false);
    setStep('closed');
  };

  const pending = step === 'outcome' && outcome?.kind === 'pending';
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-armed only by a new pending answer; recheck reads the live refs.
  useEffect(() => {
    if (!pending || rechecks >= WALLET_PAY_AUTO_RECHECKS) return;
    const timer = setTimeout(() => void recheck(), WALLET_PAY_RECHECK_MS);
    return () => clearTimeout(timer);
  }, [pending, rechecks]);

  return {
    step,
    pin,
    setPin: (next: string) => {
      setError(null);
      setPinState(next);
    },
    error,
    outcome,
    amountKobo,
    busy,
    open,
    submit,
    recheck,
    close,
  };
}

export type WalletPaySheetState<Result> = ReturnType<
  typeof useWalletPaySheet<Result>
>;
