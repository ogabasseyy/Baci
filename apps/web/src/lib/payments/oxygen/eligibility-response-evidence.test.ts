import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { projectEligibilityEvidence } from './eligibility-response-evidence';

it('projects bounded eligibility values while withholding identifiers', () => {
  const result = projectEligibilityEvidence({
    status: 'COMPLETED',
    is_eligible: true,
    eligible_amount: 10000,
    max_loan_amount: -1,
    partner_reference: 'private-partner',
    message: 'private-message',
  });
  expect(result.eligibility?.values).toEqual({
    status: 'COMPLETED',
    is_eligible: true,
    eligible_amount: 10000,
  });
  expect(result.eligibility?.shape.partner_reference).toBe('string');
  expect(JSON.stringify(result)).not.toContain('private-partner');
  expect(JSON.stringify(result)).not.toContain('private-message');
  expect(projectEligibilityEvidence(null)).toEqual({});
});
