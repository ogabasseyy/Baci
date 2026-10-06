import { expect, it } from 'vitest';
import { PURCHASE_CURRENT_RECOVERY_STATEMENTS } from './purchase-current-recovery-statements';

it('allows only the exact seven-parameter read for the restricted policy writer', () => {
  expect(PURCHASE_CURRENT_RECOVERY_STATEMENTS).toEqual({
    purchaseCurrentRecovery: {
      text: 'SELECT piggyvest_purchase_preparation.read_current_recovery($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid) AS result',
      parameters: 7,
      roles: ['piggyvest_staging_policy_writer'],
    },
  });
});
