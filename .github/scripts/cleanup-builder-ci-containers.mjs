import { spawnSync } from 'node:child_process';
import { builderCiContainerLabels } from '../../apps/web/tools/builder-auth/ci-container-labels.mjs';

const labels = builderCiContainerLabels();
if (labels.length !== 4) {
  console.error(
    'Refusing cleanup without valid CI run, attempt, job, and scope identifiers'
  );
  process.exit(1);
}

function listMatchingContainers() {
  const list = spawnSync(
    'docker',
    [
      'ps',
      '-aq',
      '--no-trunc',
      ...labels.flatMap((label) => ['--filter', `label=${label}`]),
    ],
    { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' }
  );
  if (list.error || list.status !== 0) {
    console.error(
      'Could not list builder test containers',
      list.error?.message ?? list.stderr
    );
    process.exit(1);
  }
  const ids = list.stdout.split(/\s+/).filter(Boolean);
  if (ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) {
    console.error('Refusing cleanup: Docker returned an invalid container ID');
    process.exit(1);
  }
  return ids;
}

const ids = listMatchingContainers();
if (ids.length > 0) {
  const remove = spawnSync('docker', ['rm', '-fv', ...ids], {
    encoding: 'utf8',
    timeout: 30000,
    killSignal: 'SIGKILL',
  });
  if (
    (remove.error || remove.status !== 0) &&
    listMatchingContainers().length > 0
  ) {
    console.error(
      'Could not remove builder test containers',
      remove.error?.message ?? remove.stderr
    );
    process.exit(1);
  }
}
