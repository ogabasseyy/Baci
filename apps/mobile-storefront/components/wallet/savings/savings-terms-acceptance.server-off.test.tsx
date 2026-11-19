import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import {
  TERMS_REQUIRED_MESSAGE,
  useSavingsTermsAcceptance,
} from './savings-terms-acceptance';

// Pure form state: it never calls the server, so it behaves the same with
// PiggyVest switched off.
function setup(initialError: string | null) {
  return renderHook(() => {
    const [formError, setFormError] = useState<string | null>(initialError);
    const [accepted, setAccepted] = useSavingsTermsAcceptance(setFormError);
    return { accepted, formError, setAccepted };
  });
}

describe('useSavingsTermsAcceptance with PiggyVest off', () => {
  it('starts unticked', () => {
    expect(setup(null).result.current.accepted).toBe(false);
  });

  describe('bugfix: the terms message stayed after the box was ticked', () => {
    it('clears the tick-the-box message when the box is ticked', () => {
      const { result } = setup(TERMS_REQUIRED_MESSAGE);
      act(() => result.current.setAccepted(true));
      expect(result.current.accepted).toBe(true);
      expect(result.current.formError).toBeNull();
    });
  });

  it('leaves any other form message alone', () => {
    const { result } = setup('Select a saved card for auto debit.');
    act(() => result.current.setAccepted((value) => !value));
    expect(result.current.accepted).toBe(true);
    expect(result.current.formError).toBe(
      'Select a saved card for auto debit.'
    );
  });

  it('uses plain words, not jargon', () => {
    expect(TERMS_REQUIRED_MESSAGE).not.toMatch(/non-withdrawable/i);
  });
});
