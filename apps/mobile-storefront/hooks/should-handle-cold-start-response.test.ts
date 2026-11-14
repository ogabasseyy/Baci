import { shouldHandleColdStartResponse } from './should-handle-cold-start-response';

it('accepts a cold-start response when no live response arrived', () => {
  expect(shouldHandleColdStartResponse(true, false)).toBe(true);
});

it('ignores a cold-start response after a newer live response arrived', () => {
  expect(shouldHandleColdStartResponse(true, true)).toBe(false);
});

it('ignores an absent cold-start response', () => {
  expect(shouldHandleColdStartResponse(false, false)).toBe(false);
});
