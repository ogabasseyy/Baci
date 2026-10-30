export const WORKER_CREDENTIAL_ISOLATION_PATHS = Object.freeze({
  githubCredential: '/home/bassey/.config/gh/hosts.yml',
  releaseWorkspace: '/home/baci-release/actions-runner/_work',
  workerRoot: '/srv/baci-workers',
  workerEnvironment: '/srv/baci-workers/runtime/worker.env',
});

export const WORKER_CREDENTIAL_ISOLATION_USERS = Object.freeze({
  release: 'baci-release',
  worker: 'baci-worker',
  forbiddenGroups: ['docker', 'sudo'],
});

/**
 * Evaluate metadata-only observations collected by the host verifier.
 * The observation contains booleans and group names only; never file contents.
 */
export function evaluateWorkerCredentialIsolation(observation) {
  const failures = [];
  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  check(observation?.accounts?.release === true, 'release account exists');
  check(observation?.accounts?.worker === true, 'worker account exists');
  for (const role of ['release', 'worker']) {
    const groups = observation?.groups?.[role];
    check(Array.isArray(groups), `${role} supplementary groups are known`);
    if (Array.isArray(groups)) {
      for (const forbidden of WORKER_CREDENTIAL_ISOLATION_USERS.forbiddenGroups) {
        check(!groups.includes(forbidden), `${role} is not in ${forbidden}`);
      }
    }
  }

  const access = observation?.access;
  check(access?.releaseReadsGithubCredential === false, 'release cannot read the persisted GitHub credential');
  check(access?.workerReadsGithubCredential === false, 'worker cannot read the persisted GitHub credential');
  check(access?.workerWritesGithubCredential === false, 'worker cannot write the persisted GitHub credential');
  check(access?.workerReadsReleaseWorkspace === false, 'worker cannot read the release workspace');
  check(access?.releaseReadsWorkerEnvironment === false, 'release cannot read the worker environment');
  check(access?.releaseWritesWorkerRoot === false, 'release cannot write the worker root');
  check(access?.workerReadsWorkerEnvironment === true, 'worker can read its runtime environment');

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}
