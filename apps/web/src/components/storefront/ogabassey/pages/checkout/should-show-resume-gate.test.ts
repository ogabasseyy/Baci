import { expect, it } from 'vitest';
import { shouldShowResumeGate } from './should-show-resume-gate';

it('shows resume status only for active processing or an empty cart awaiting or failing a resume', () => {
  expect(shouldShowResumeGate(true, true, false, false)).toBe(true);
  expect(shouldShowResumeGate(true, false, false, true)).toBe(true);
  expect(shouldShowResumeGate(false, false, true, false)).toBe(true);
  expect(shouldShowResumeGate(false, true, false, true)).toBe(false);
  expect(shouldShowResumeGate(true, false, false, false)).toBe(false);
});
