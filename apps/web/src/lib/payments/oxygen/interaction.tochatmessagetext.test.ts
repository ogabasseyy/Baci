import { describe, expect, it } from 'vitest';
import { toChatMessageText } from './interaction';
import {
  FIXTURE_EMAIL,
  FIXTURE_ORDER_ID,
  S04_MESSAGE_TABLE,
} from './interaction.test-helpers';

describe('toChatMessageText', () => {
  it.each(S04_MESSAGE_TABLE)('returns the S-04 message for a known $reason', ({
    reason,
    message,
  }) => {
    expect(toChatMessageText({ status: 'unavailable', reason })).toBe(message);
  });

  it('returns the status default when the reason is omitted', () => {
    expect(toChatMessageText({ status: 'ready' })).toBe(
      'Oxygen is available for this order.'
    );
    expect(toChatMessageText({ status: 'failed' })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for an unknown status, never echoing the input', () => {
    expect(toChatMessageText({ status: FIXTURE_ORDER_ID })).toBe(
      'Something went wrong.'
    );
    expect(
      toChatMessageText({
        status: FIXTURE_ORDER_ID,
        reason: 'oxygen_rollout_disabled',
      })
    ).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'interrupted' })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for an unknown reason, never echoing the input', () => {
    expect(
      toChatMessageText({ status: 'failed', reason: FIXTURE_ORDER_ID })
    ).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'failed', reason: FIXTURE_EMAIL })).toBe(
      'Something went wrong.'
    );
  });

  it('falls back for non-string inputs', () => {
    expect(toChatMessageText({ status: null })).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 42 })).toBe('Something went wrong.');
    expect(toChatMessageText({ status: 'ready', reason: { id: 1 } })).toBe(
      'Something went wrong.'
    );
  });
});
