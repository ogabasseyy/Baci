import { expect, it } from 'vitest';
import { CANCELLATION_RECOVERY_STATEMENTS } from './cancellation-recovery-statements';

it('permits only the exact read-only seven-parameter lookup for the policy writer', () => {
  expect(CANCELLATION_RECOVERY_STATEMENTS).toEqual({
    readCancellationRecovery: {
      text: 'SELECT piggyvest_cancel_plan.read_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
      parameters: 7,
      roles: ['piggyvest_staging_policy_writer'],
    },
  });
});
