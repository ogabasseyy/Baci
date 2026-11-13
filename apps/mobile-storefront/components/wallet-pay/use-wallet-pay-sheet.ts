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
  // True while a start, PIN check or pay call is out: a second open, a
  // second submit or a re-check never overlaps it.
  const inFlight = useRef(false);
  // The last purchase opened, so a start that never answered can be retried.
  const lastAdapter = useRef<WalletPayAdapter<Result> | null>(null);

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
    inFlight.current = true;
    setStep('paying');
    const answer = await active.pay(id, proof).catch(
      (): WalletPayPayAnswer<Result> => ({
        kind: 'outcome',
        outcome: { kind: 'pending' },
      })
    );
    if (!current(mine)) return;
    inFlight.current = false;
    finish(answer);
  };

  const open = async (next: WalletPayAdapter<Result>) => {
    // A double tap must not start a second payment over the first, and a
    // sheet already open is never restarted under the customer.
    if (inFlight.current || step !== 'closed') return;
    inFlight.current = true;
    lastAdapter.current = next;
    generation.current += 1;
    const mine = generation.current;
    adapter.current = next;
    operationId.current = null;
    setPinState('');
    setError(null);
    setOutcome(null);
    setAmountKobo(null);
    setRechecks(0);
    setBusy(false);
    await begin(next, mine);
  };

  // Runs (or re-runs) the start for the open sheet.
  const begin = async (next: WalletPayAdapter<Result>, mine: number) => {
    inFlight.current = true;
    setStep('starting');
    const started = await next.start().catch(() => ({
      kind: 'outcome' as const,
      outcome: { kind: 'not_started' as const },
    }));
    if (!current(mine)) return;
    inFlight.current = false;
    if (started.kind === 'delivered') return finish(started);
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
    if (inFlight.current || step !== 'enter' || !id || !active) return;
    if (!/^[0-9]{4,6}$/.test(pin)) {
      setError(PIN_FORMAT);
      return;
    }
    const mine = generation.current;
    const typed = pin;
    setPinState('');
    setError(null);
    inFlight.current = true;
    setBusy(true);
    const answer = await active.verifyPin(id, typed).catch(() => ({
      kind: 'retry' as const,
      // A correct PIN resets the server's wrong-PIN count, so entering it
      // again after a lost answer never moves the customer toward a lock.
      message:
        "We didn't hear back about your PIN. Nothing was paid. Please enter it again.",
    }));
    if (!current(mine)) return;
    inFlight.current = false;
    setBusy(false);
    if (answer.kind === 'retry') return setError(answer.message);
    if (answer.kind === 'outcome') {
      setOutcome(answer.outcome);
      return setStep('outcome');
    }
    await pay(answer.proof);
  };

  const recheck = async () => {
    if (inFlight.current) return;
    setRechecks((count) => count + 1);
    // No payment id yet (the start itself is still settling): ask again.
    if (!operationId.current) {
      if (adapter.current) await begin(adapter.current, generation.current);
      return;
    }
    await pay('');
  };

  const close = () => {
    generation.current += 1;
    inFlight.current = false;
    adapter.current = null;
    operationId.current = null;
    setPinState('');
    setError(null);
    setBusy(false);
    setStep('closed');
  };

  // Under review is re-checked too: a payment PiggyVest confirms later must
  // still reach the pay step (with the IMEI) to deliver the purchase.
  const pending =
    step === 'outcome' &&
    (outcome?.kind === 'pending' || outcome?.kind === 'review');
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
    /**
     * For the next open(): true while that sheet is still the one on screen,
     * i.e. while it will take an answer. A key is only forgotten then.
     */
    nextSession: () => {
      const mine = generation.current + 1;
      return () => current(mine);
    },
    submit,
    recheck,
    /** Runs the same start again (same purchase key) after it never answered. */
    retryStart: async () => {
      if (lastAdapter.current && !inFlight.current)
        await begin(lastAdapter.current, generation.current);
    },
    close,
    /**
     * Back while the sheet is open (the screen routes its back gesture here):
     * close it, except while a payment is being sent. That no-op is on
     * purpose: the sheet shows "Paying from your PiggyVest wallet..." and
     * hiding it mid-send would leave the customer without the outcome.
     * Closing while starting is safe: no money moves before the PIN.
     */
    back: () => {
      // Same gate as the sheet's own close button.
      if (step !== 'paying' && !busy) close();
    },
  };
}

export type WalletPaySheetState<Result> = ReturnType<
  typeof useWalletPaySheet<Result>
>;
