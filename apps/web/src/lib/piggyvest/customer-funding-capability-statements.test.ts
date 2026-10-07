import { expect, it } from 'vitest';
import { CUSTOMER_FUNDING_CAPABILITY_STATEMENTS } from './customer-funding-capability-statements';

it('exposes one read-only policy-writer statement without helper or write grants', () => {
  expect(CUSTOMER_FUNDING_CAPABILITY_STATEMENTS).toEqual({
    readFundingCapability: {
      text: 'SELECT piggyvest_goal_policy.read_funding_capability($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result',
      parameters: 6,
      roles: ['piggyvest_staging_policy_writer'],
    },
  });
});
