import { expect, it } from 'vitest';
import { PIGGYVEST_PROVISIONING_RECOVERY_STATEMENTS as statements } from './provisioning-recovery-statements';

it('restricts recovery and provenance calls to the provisioner role', () => {
  expect(Object.keys(statements)).toHaveLength(6);
  for (const statement of Object.values(statements)) {
    expect(statement.roles).toEqual(['piggyvest_staging_provisioner']);
    expect(statement.text).toContain('piggyvest_staging.');
  }
  expect(statements.confirmProvisioningRecovery.parameters).toBe(11);
  expect(statements.recordCreatedCustomer.parameters).toBe(7);
  expect(statements.readCustomerMapping.parameters).toBe(4);
  expect(statements.readCustomerMapping.roles).toEqual([
    'piggyvest_staging_provisioner',
  ]);
});
