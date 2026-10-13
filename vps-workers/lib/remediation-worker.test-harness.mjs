import { createRemediationWorker } from './remediation-worker-factory.mjs';

const testRemediationLock = {};
const isTestRemediationLock = (lock) => lock === testRemediationLock;

const runTestWorker = createRemediationWorker({
  lockCapabilityValidator: isTestRemediationLock,
  usesGlobalCaseStateLock: false,
});

const runTestWorkerWithGlobalCaseStateLock = createRemediationWorker({
  lockCapabilityValidator: isTestRemediationLock,
});

const withTestRemediationLock =
  (runWorker) =>
  (options = {}) =>
    runWorker({
      ...options,
      containerIdentity: options.containerIdentity ?? {
        gid: 1001,
        uid: 1001,
      },
      remediationLock: options.remediationLock ?? testRemediationLock,
    });

export const runRemediationWorker = withTestRemediationLock(runTestWorker);

export const runRemediationWorkerWithGlobalCaseStateLock =
  withTestRemediationLock(runTestWorkerWithGlobalCaseStateLock);
