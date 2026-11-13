/**
 * How a PiggyVest wallet payment ended, as far as the customer is concerned.
 * 'pending' covers every unknown: money may have moved, so the app never
 * calls it failed and keeps checking instead.
 */
export type WalletPayOutcomeKind =
  | 'pending'
  | 'review'
  | 'refunded'
  | 'insufficient'
  | 'not_completed'
  | 'unavailable'
  | 'pin_locked'
  | 'pin_setup'
  | 'sign_in'
  // The start never answered: nothing was paid, the same start can be retried.
  | 'not_started'
  | 'failed';

export type WalletPayOutcome = {
  kind: WalletPayOutcomeKind;
  /** The server's own words, when they say more than the default. */
  message?: string;
  /**
   * The payment may already have been sent (a refusal on a re-check), so
   * the wording must not claim that nothing was taken.
   */
  maybePaid?: boolean;
};

export type WalletPayStart<Result> =
  | { kind: 'pin'; operationId: string; amountKobo: number }
  // The purchase was already paid and delivered (a replayed start).
  | { kind: 'delivered'; result: Result }
  // A payment already sent for this purchase: check on it, never re-pay.
  | { kind: 'recheck'; operationId: string; amountKobo: number }
  | { kind: 'outcome'; outcome: WalletPayOutcome };

export type WalletPayPinAnswer =
  | { kind: 'proof'; proof: string }
  // Stay on the PIN step with this message (wrong PIN, busy).
  | { kind: 'retry'; message: string }
  | { kind: 'outcome'; outcome: WalletPayOutcome };

export type WalletPayPayAnswer<Result> =
  | { kind: 'delivered'; result: Result }
  // The proof was refused: enter the PIN again for the same payment.
  | { kind: 'pin_again'; message: string }
  | { kind: 'outcome'; outcome: WalletPayOutcome };

/** One product's way to start, approve and pay (IMEI today, VTU next). */
export interface WalletPayAdapter<Result> {
  start(): Promise<WalletPayStart<Result>>;
  verifyPin(operationId: string, pin: string): Promise<WalletPayPinAnswer>;
  /** proof '' only checks on a payment already sent. */
  pay(operationId: string, proof: string): Promise<WalletPayPayAnswer<Result>>;
}
