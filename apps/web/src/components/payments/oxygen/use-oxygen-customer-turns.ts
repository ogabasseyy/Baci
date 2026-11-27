import { useState } from 'react';
import {
  oxygenBankTurns,
  oxygenIdentityTurns,
  oxygenIncomeTurns,
} from './OxygenChatQuestion';

export function useOxygenCustomerTurns(
  savedStep: number,
  conversational: boolean
) {
  const [step, setStep] = useState(Math.min(Math.max(savedStep, 0), 2));
  const [chatTurn, setChatTurn] = useState(0);
  const turn = conversational ? chatTurn : undefined;
  const bankSelection = step === 1 && turn === oxygenBankTurns.bank;
  const checkingAccount = step === 1 && !bankSelection;
  const nextQuestion =
    (step === 0 && turn !== undefined && turn < oxygenIdentityTurns.dob) ||
    bankSelection ||
    (step === 2 && turn !== undefined && turn < oxygenIncomeTurns.consent);
  function goToStep(nextStep: number) {
    setChatTurn(0);
    setStep(nextStep);
  }
  function advanceQuestion() {
    setChatTurn(
      step === 2 && chatTurn === oxygenIncomeTurns.payday
        ? oxygenIncomeTurns.consent
        : chatTurn + 1
    );
  }
  function back() {
    if (turn !== undefined && turn > 0) {
      setChatTurn(
        step === 2 && turn === oxygenIncomeTurns.consent
          ? oxygenIncomeTurns.payday
          : turn - 1
      );
      return false;
    }
    if (step === 2) {
      setChatTurn(conversational ? oxygenBankTurns.account : 0);
    } else if (step === 1) {
      setChatTurn(conversational ? oxygenIdentityTurns.dob : 0);
    } else {
      setChatTurn(0);
    }
    setStep(step - 1);
    return true;
  }
  return {
    step,
    turn,
    chatTurn,
    bankSelection,
    checkingAccount,
    nextQuestion,
    goToStep,
    advanceQuestion,
    back,
  };
}
