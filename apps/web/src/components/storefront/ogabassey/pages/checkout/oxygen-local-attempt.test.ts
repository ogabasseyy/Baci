import { expect, it } from 'vitest';
import { oxygenLocalAttempt } from './oxygen-local-attempt';
const attempt = '20000000-0000-4000-8000-000000000001';
const source = '20000000-0000-4000-8000-000000000002';
it('only separates an explicitly identified local test attempt', () => {
  const params = new URLSearchParams({
    oxygenTestAttempt: attempt,
    oxygenDraftSource: source,
  });
  expect(oxygenLocalAttempt(params, true)).toEqual({ attempt, source });
  expect(oxygenLocalAttempt(params, false)).toBeNull();
  expect(oxygenLocalAttempt(new URLSearchParams(), true)).toBeNull();
  expect(
    oxygenLocalAttempt(new URLSearchParams({ oxygenTestAttempt: 'bad' }), true)
  ).toBeNull();
});
