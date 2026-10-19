import { beforeEach, expect, it } from 'vitest';
import {
  clearActiveHandoff,
  clearAttemptBody,
  loadActiveHandoff,
  loadAttemptBody,
  recordActiveHandoff,
  recordAttemptBody,
} from './cart-handoff-attempt-store';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it('persists the exact attempt body until cleared', () => {
  const body = { attemptId: 'a1', choice: 'merge', lines: [] };
  recordAttemptBody('handoff-body', body);
  expect(loadAttemptBody('handoff-body')).toEqual(body);
  clearAttemptBody('handoff-body');
  expect(loadAttemptBody('handoff-body')).toBeNull();
});

it('keeps the active locator until its own handoff clears', () => {
  recordActiveHandoff('pairing-secret', 'handoff-a', 'shop');
  expect(loadActiveHandoff()).toEqual({
    token: 'pairing-secret',
    handoffId: 'handoff-a',
    merchantSlug: 'shop',
  });
  // A later record without scope knowledge preserves the slug.
  recordActiveHandoff('pairing-secret', 'handoff-a');
  expect(loadActiveHandoff()?.merchantSlug).toBe('shop');
  clearActiveHandoff('handoff-other');
  expect(loadActiveHandoff()).not.toBeNull();
  clearActiveHandoff('handoff-a');
  expect(loadActiveHandoff()).toBeNull();
});
