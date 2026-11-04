import { describe, expect, it } from 'vitest';
import {
  getOxygenInteractionCopy,
  OXYGEN_INTERACTION_FALLBACK_COPY,
  type OxygenInteractionReason,
} from './interaction';
import {
  FIXTURE_ORDER_ID,
  S04_MESSAGE_TABLE,
} from './interaction.test-helpers';

describe('getOxygenInteractionCopy', () => {
  it.each(
    S04_MESSAGE_TABLE
  )('prefers the reason message for unavailable + $reason', ({
    reason,
    message,
  }) => {
    expect(getOxygenInteractionCopy('unavailable', reason)).toBe(message);
  });

  it('uses the guest message for signin-required with the guest reason', () => {
    expect(
      getOxygenInteractionCopy('signin-required', 'oxygen_guest_not_allowed')
    ).toBe('Sign in to continue with Oxygen.');
  });

  it('falls back to the guest message for reason-less signin-required (401 path)', () => {
    expect(getOxygenInteractionCopy('signin-required')).toBe(
      'Sign in to continue with Oxygen.'
    );
  });

  it('pins every reason-less state default', () => {
    expect(getOxygenInteractionCopy('checking')).toBe(
      'Checking Oxygen availability…'
    );
    expect(getOxygenInteractionCopy('ready')).toBe(
      'Oxygen is available for this order.'
    );
    expect(getOxygenInteractionCopy('initiating')).toBe(
      'Starting Oxygen… Do not close this window.'
    );
    expect(getOxygenInteractionCopy('handed-off')).toBe(
      'Continue with Oxygen in the secure form.'
    );
    expect(getOxygenInteractionCopy('failed')).toBe('Something went wrong.');
    expect(getOxygenInteractionCopy('idle')).toBe('Something went wrong.');
    expect(getOxygenInteractionCopy('unavailable')).toBe(
      'Something went wrong.'
    );
  });

  it('covers "continue where you left off" while resuming', () => {
    expect(getOxygenInteractionCopy('resuming').toLowerCase()).toContain(
      'continue where you left off'
    );
  });

  it('keeps the do-not-close instruction while initiating', () => {
    expect(getOxygenInteractionCopy('initiating').toLowerCase()).toContain(
      'do not close'
    );
  });

  it('never echoes an unknown reason; fails safe to the status default', () => {
    expect(
      getOxygenInteractionCopy(
        'unavailable',
        FIXTURE_ORDER_ID as OxygenInteractionReason
      )
    ).toBe('Something went wrong.');
    expect(
      getOxygenInteractionCopy(
        'ready',
        FIXTURE_ORDER_ID as OxygenInteractionReason
      )
    ).toBe('Oxygen is available for this order.');
  });

  it('exposes the generic fallback copy', () => {
    expect(OXYGEN_INTERACTION_FALLBACK_COPY).toBe('Something went wrong.');
  });
});
