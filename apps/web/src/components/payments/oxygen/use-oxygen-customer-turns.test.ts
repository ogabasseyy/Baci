import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { oxygenIdentityTurns, oxygenIncomeTurns } from './OxygenChatQuestion';
import { useOxygenCustomerTurns } from './use-oxygen-customer-turns';

describe('useOxygenCustomerTurns', () => {
  it('advances and rewinds identity turns in conversational mode without leaving step 0', () => {
    const { result } = renderHook(() => useOxygenCustomerTurns(0, true));
    expect(result.current.step).toBe(0);
    expect(result.current.chatTurn).toBe(oxygenIdentityTurns.bvn);
    expect(result.current.nextQuestion).toBe(true);

    act(() => result.current.advanceQuestion());
    expect(result.current.chatTurn).toBe(oxygenIdentityTurns.nin);

    let leftStep = true;
    act(() => {
      leftStep = result.current.back();
    });
    expect(leftStep).toBe(false);
    expect(result.current.step).toBe(0);
    expect(result.current.chatTurn).toBe(oxygenIdentityTurns.bvn);
  });

  it('goes directly from payday to consent on step 2 without a residential address turn', () => {
    const { result } = renderHook(() => useOxygenCustomerTurns(0, true));
    act(() => result.current.goToStep(2));
    act(() => result.current.advanceQuestion()); // employer
    act(() => result.current.advanceQuestion()); // amount
    act(() => result.current.advanceQuestion()); // payday
    expect(result.current.chatTurn).toBe(oxygenIncomeTurns.payday);

    act(() => result.current.advanceQuestion());
    expect(result.current.chatTurn).toBe(oxygenIncomeTurns.consent);

    act(() => {
      result.current.back();
    });
    expect(result.current.chatTurn).toBe(oxygenIncomeTurns.payday);
  });

  it('restores saved step up to 2 on reload', () => {
    const { result } = renderHook(() => useOxygenCustomerTurns(2, false));
    expect(result.current.step).toBe(2);
  });
});
