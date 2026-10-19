'use client';
import type { MutableRefObject } from 'react';
import { useState } from 'react';
import { postHandoffRedeem } from './cart-handoff-redeem';
import {
  type Choice,
  clearActiveHandoff,
  clearAttemptBody,
  clearHandoffAttempt,
  loadAttemptBody,
  type MergeConflictView,
  recordAttemptBody,
  recordAttemptChoice,
} from './cart-handoff-support';

export interface HandoffRedeemWiring {
  handoffId: string;
  merchantSlug: string | null | undefined;
  bootstrapRequired: MutableRefObject<boolean>;
  setRedeeming(value: boolean): void;
  setRedeemError(value: string | null): void;
  setConflicts(value: MergeConflictView[]): void;
  setResolutions(value: Record<string, 'incoming' | 'existing'>): void;
  setLoadError(value: string | null): void;
  refreshPreview(): Promise<unknown>;
}

/**
 * Stateful redemption wiring for the handoff hook: the locked first
 * choice, the persisted exact body (retries resend it verbatim), and
 * the outcome callbacks that reset attempt/locator state.
 */
export function useHandoffRedeem(wiring: HandoffRedeemWiring) {
  const { handoffId } = wiring;
  const [lockedChoice, setLockedChoice] = useState<Choice | null>(null);
  const [sentBody, setSentBody] = useState<Record<string, unknown> | null>(
    null
  );

  function restorePersistedAttempt(): void {
    setSentBody(loadAttemptBody(handoffId));
  }

  function lockChoice(choice: Choice): void {
    recordAttemptChoice(handoffId, choice);
    setLockedChoice(choice);
  }

  function clearLockedChoice(): void {
    setLockedChoice(null);
    setSentBody(null);
  }

  function postRedeem(
    body: Record<string, unknown>,
    merchantSlug = wiring.merchantSlug
  ): Promise<boolean> {
    // Persist the exact body before sending: retries of an unresolved
    // attempt resend it verbatim instead of replanning from the
    // shopper's possibly edited selections.
    recordAttemptBody(handoffId, body);
    setSentBody(body);
    return postHandoffRedeem(
      {
        handoffId,
        merchantSlug,
        bootstrapRequired: wiring.bootstrapRequired,
        setRedeeming: wiring.setRedeeming,
        setRedeemError: wiring.setRedeemError,
        setConflicts: wiring.setConflicts,
        setResolutions: wiring.setResolutions,
        setLoadError: wiring.setLoadError,
        onAttemptConsumed: () => {
          clearHandoffAttempt(handoffId);
          clearLockedChoice();
        },
        onTerminalOutcome: () => {
          clearActiveHandoff(handoffId);
        },
        onMergeConflict: () => {
          clearAttemptBody(handoffId);
          setSentBody(null);
        },
        refreshPreview: wiring.refreshPreview,
      },
      body
    );
  }

  return {
    lockedChoice,
    setLockedChoice,
    sentBody,
    attemptSent: sentBody !== null,
    restorePersistedAttempt,
    lockChoice,
    clearLockedChoice,
    postRedeem,
  };
}
