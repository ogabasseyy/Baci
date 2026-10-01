import { hasRemediationGlobalLockCapability } from './remediation-global-lock.mjs';
import { createRemediationWorker } from './remediation-worker-factory.mjs';

export const runRemediationWorker = createRemediationWorker({
  lockCapabilityValidator: hasRemediationGlobalLockCapability,
});
