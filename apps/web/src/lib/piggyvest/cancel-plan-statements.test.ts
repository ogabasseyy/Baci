import { expect, it } from 'vitest';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';

it('exposes only two exact six-parameter entry points to the standard policy writer', () => {
  expect(CANCEL_PLAN_STATEMENTS).toEqual({
    quoteCancelPlan: {
      text: 'SELECT piggyvest_cancel_plan.quote($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid) AS result',
      parameters: 6,
      roles: ['piggyvest_staging_policy_writer'],
    },
    prepareCancelPlan: {
      text: 'SELECT piggyvest_cancel_plan.prepare($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::jsonb) AS result',
      parameters: 6,
      roles: ['piggyvest_staging_policy_writer'],
    },
  });
});
