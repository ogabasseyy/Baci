import { expect, it } from 'vitest';
import { AttemptAdmissionDenied } from './api-attempt-policy';

it('retains unsent versus explicit-CSRF-rejection provenance without request contents', () => {
  expect(
    new AttemptAdmissionDenied('STALE_ROUTE', false, 'none')
  ).toMatchObject({
    code: 'STALE_ROUTE',
    attempted: false,
    priorOutcome: 'none',
  });
  expect(
    new AttemptAdmissionDenied('STALE_ROUTE', true, 'csrf-rejected').message
  ).toBe('Request admission denied');
});
