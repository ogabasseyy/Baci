import { expect, it } from 'vitest';
import {
  formatMinor,
  loadOrCreateAttemptId,
  redactHandoffFragment,
} from './cart-handoff-support';

it('preserves the redemption attempt after a response is lost', () => {
  sessionStorage.clear();
  const first = loadOrCreateAttemptId('handoff-a');
  expect(loadOrCreateAttemptId('handoff-a')).toBe(first);
  expect(loadOrCreateAttemptId('handoff-b')).not.toBe(first);
});
it('formats minor units rather than multiplying a displayed price', () => {
  expect(formatMinor(12345, 'NGN')).toContain('123.45');
});
it('keeps a stable attempt when storage access throws', () => {
  const getter = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('denied');
    },
  });
  try {
    const first = loadOrCreateAttemptId('blocked-storage');
    expect(loadOrCreateAttemptId('blocked-storage')).toBe(first);
  } finally {
    if (getter) Object.defineProperty(window, 'localStorage', getter);
  }
});

it('removes pairing fragments while preserving the destination path and query', () => {
  window.history.replaceState(
    null,
    '',
    '/cart/handoff?handoff_id=example#private-token'
  );
  redactHandoffFragment();
  expect(window.location.pathname + window.location.search).toBe(
    '/cart/handoff?handoff_id=example'
  );
  expect(window.location.hash).toBe('');
});
