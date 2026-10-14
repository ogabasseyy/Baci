import { expect, it } from 'vitest';
import { formatMinor, loadOrCreateAttemptId } from './cart-handoff-support';

it('preserves the redemption attempt after a response is lost', () => {
  sessionStorage.clear();
  const first = loadOrCreateAttemptId('handoff-a');
  expect(loadOrCreateAttemptId('handoff-a')).toBe(first);
  expect(loadOrCreateAttemptId('handoff-b')).not.toBe(first);
});
it('formats minor units rather than multiplying a displayed price', () => {
  expect(formatMinor(12345, 'NGN')).toContain('123.45');
});
