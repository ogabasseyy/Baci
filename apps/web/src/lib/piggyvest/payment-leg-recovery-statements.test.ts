import { expect, it } from 'vitest';
import { PAYMENT_LEG_RECOVERY_STATEMENTS as statements } from './payment-leg-recovery-statements';

it('limits both exact operations to the policy writer and eight scope/actor/identity parameters', () => {
  for (const entry of Object.values(statements)) {
    expect(entry.parameters).toBe(8);
    expect(entry.roles).toEqual(['piggyvest_staging_policy_writer']);
    expect(entry.text).toMatch(
      /^SELECT piggyvest_purchase_preparation\.(read|observe)_payment_leg_recovery\(\$1::uuid,\$2::uuid,\$3::uuid,\$4::uuid,\$5::text,\$6::uuid,\$7::uuid,\$8::(uuid|jsonb)\) AS result$/
    );
  }
});
