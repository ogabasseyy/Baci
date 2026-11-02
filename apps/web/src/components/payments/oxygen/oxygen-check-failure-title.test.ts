import { expect, it } from 'vitest';
import { oxygenCheckFailureTitle } from './oxygen-check-failure-title';

it('identifies an address failure separately from identity and eligibility', () => {
  expect(oxygenCheckFailureTitle('submit_address')).toContain('home address');
  expect(oxygenCheckFailureTitle('validate_nin')).toContain('NIN check');
  expect(oxygenCheckFailureTitle('refresh_eligibility')).toContain(
    'eligibility check'
  );
  expect(oxygenCheckFailureTitle('refresh_kyc')).toBe(
    'We couldn’t complete this check'
  );
});
