import { expect, it } from 'vitest';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';
import { PIGGYVEST_PROVISIONING_LIMITS as limits } from './provisioning-limits';

it('leaves time to record a result within the provisioning lease', () => {
  expect(limits.minimumRemainingLeaseMs).toBeGreaterThan(
    PIGGYVEST_POSTGRES_EXECUTOR.deadlineMs
  );
  expect(limits.minimumRemainingLeaseMs).toBeLessThan(
    limits.claimLeaseSeconds * 1000
  );
});
