import {
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import {
  codeOf,
  GOAL_LIFECYCLE_COPY,
  messageOf,
  NOT_STARTABLE_CODES,
} from './goal-lifecycle-outcomes';

describe('server keeps PiggyVest off', () => {
  it('a not-ready refusal reads as its server text and never offers Start again', () => {
    const error = serverOffError('SAVINGS_NOT_READY');
    expect(codeOf(error)).toBe('SAVINGS_NOT_READY');
    expect(messageOf(error)).toBe('not ready');
    expect(NOT_STARTABLE_CODES).toContain('SAVINGS_NOT_READY');
    expect(SERVER_OFF_MERCHANT_ID).toBeTruthy();
  });

  it('an error from anywhere else never leaks its text', () => {
    expect(messageOf(serverOffError('SOMETHING_ELSE'))).toBe(
      GOAL_LIFECYCLE_COPY.generic
    );
    expect(messageOf(new Error('Network request failed'))).toBe(
      GOAL_LIFECYCLE_COPY.generic
    );
  });
});
