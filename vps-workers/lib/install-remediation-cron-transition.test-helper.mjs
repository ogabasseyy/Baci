import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  crontabStub,
  flockStub,
  writeExecutable,
  writeJob,
  writeStage,
} from './install-remediation-cron-transition.test-fixtures.mjs';
import { spawnDirectScenarioProcess } from './install-remediation-cron-transition.test-scenarios.mjs';

const transitionScript = join(
  dirname(fileURLToPath(import.meta.url)),
  'install-remediation-cron-transition.sh'
);
const globalLockSource = join(
  dirname(fileURLToPath(import.meta.url)),
  'remediation-global-lock.mjs'
);
const transactionSource = join(
  dirname(fileURLToPath(import.meta.url)),
  'remediation-cron-transition.py'
);
const crontabSource = join(
  dirname(fileURLToPath(import.meta.url)),
  'remediation_cron_transition_crontab.py'
);
const dotenvSource = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.github',
  'scripts',
  'gigl-dotenv.sh'
);
// The deploy's own SHA (matches the live marker unless the scenario
// simulates a concurrent promote landing first).
const deploySha = 'f'.repeat(40);
const supersedingSha = 'e'.repeat(40);
export function runTransition(scenario) {
  const directory = mkdtempSync(join(tmpdir(), 'baci-cron-transition-'));
  const binDirectory = join(directory, 'bin');
  const crontabMarker = join(directory, 'installed-crontab');
  const lockMarker = join(directory, 'legacy-locks');
  const barrierMarker = join(directory, 'barrier-active');
  const remoteDirectory = join(
    directory,
    scenario === 'quoted-values' ? 'remote%dir' : 'remote'
  );
  const stageDirectory = join(directory, 'stage');
  const transitionTmpDirectory = join(directory, 'transition-tmp');
  const procRoot = join(directory, 'proc');
  const jobsDirectory = join(remoteDirectory, 'jobs');
  const directReady = join(directory, 'direct-ready');
  mkdirSync(binDirectory);
  mkdirSync(jobsDirectory, { recursive: true });
  mkdirSync(join(remoteDirectory, 'lib'), { recursive: true });
  mkdirSync(procRoot);
  mkdirSync(transitionTmpDirectory);
  // Mirror the post-promote live marker the transition gates on.
  writeFileSync(
    join(remoteDirectory, 'app-checkout.sha'),
    scenario === 'superseded-marker' ? supersedingSha : deploySha
  );
  const customLockEnv = {
    'custom-global-lock':
      '  BACI_REMEDIATION_GLOBAL_LOCK_PATH = "locks/custom-global.lock" # comment\n',
    'custom-global-lock-export':
      'export BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom-global.lock # comment\n',
    'custom-global-lock-colon':
      'BACI_REMEDIATION_GLOBAL_LOCK_PATH: locks/custom-global.lock\n',
    'custom-global-lock-duplicate':
      'BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/stale-global.lock\nBACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom-global.lock\n',
  };
  if (scenario in customLockEnv) {
    writeFileSync(join(remoteDirectory, '.env'), customLockEnv[scenario]);
  }
  writeStage(
    stageDirectory,
    globalLockSource,
    transactionSource,
    crontabSource
  );
  // Mirror prepare-worker-release.sh: the transition sources the
  // shared dotenv reader from the staged bin.
  mkdirSync(join(stageDirectory, 'bin'), { recursive: true });
  copyFileSync(dotenvSource, join(stageDirectory, 'bin', 'gigl-dotenv.sh'));
  if (scenario === 'partial-stage') {
    rmSync(join(stageDirectory, 'jobs', 'sentry-mobile-error-remediator.mjs'));
  }
  for (const name of [
    'vercel-error-remediator',
    'sentry-mobile-error-remediator',
    'remediation-codex-canary',
  ]) {
    writeJob(join(jobsDirectory, `${name}.mjs`), 'process.exitCode = 0;\n');
  }
  writeFileSync(
    join(remoteDirectory, 'lib', 'remediation-global-lock.mjs'),
    'export {};\n'
  );
  writeFileSync(
    join(remoteDirectory, 'lib', 'remediation-worker.mjs'),
    "export const runRemediationWorker = () => 'legacy';\n"
  );
  writeExecutable(
    join(binDirectory, 'ssh'),
    `#!/usr/bin/env bash
set -euo pipefail
shift
bash -c "$1"
`
  );
  writeExecutable(join(binDirectory, 'flock'), flockStub());
  writeExecutable(join(binDirectory, 'crontab'), crontabStub());
  if (scenario === 'non-candidate-proc') {
    const vanished = join(procRoot, '5151');
    mkdirSync(vanished);
    writeFileSync(join(vanished, 'cmdline'), 'sleep\0');
  }
  // Declared outside the try: the finally below kills the drained
  // child by pid even when the transition itself throws.
  let directProcessPid;
  let procEntry = '';
  try {
    ({ directProcessPid, procEntry } = spawnDirectScenarioProcess({
      binDirectory,
      crontabMarker,
      directReady,
      directory,
      jobsDirectory,
      procRoot,
      remoteDirectory,
      scenario,
    }));
    const result = spawnSync(
      'bash',
      [
        '-c',
        '. "$1"; install_remediation_cron_transition',
        '--',
        transitionScript,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          BARRIER_MARKER: barrierMarker,
          CODEX_CONTAINER_BIN:
            scenario === 'quoted-values'
              ? '/usr/local/bin/codex%bin'
              : '/usr/local/bin/codex',
          CODEX_REMEDIATOR_IMAGE:
            scenario === 'quoted-values'
              ? 'baci/codex%test'
              : 'baci/codex:test',
          INITIAL_CRONTAB_READ: join(directory, 'initial-crontab-read'),
          CANONICAL_REMOTE_DIR: realpathSync(remoteDirectory),
          CRONTAB_MARKER: crontabMarker,
          ROLLBACK_READ_ERROR_MARKER: join(directory, 'rollback-read-error'),
          DIRECT_PROCESS_PID: directProcessPid ?? '',
          LOCK_MARKER: lockMarker,
          NODE_BIN:
            scenario === 'alternate-node-exit'
              ? '/opt/alternate-node/bin/node'
              : scenario === 'quoted-values'
                ? '/opt/node%bin/node'
                : process.execPath,
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          OPERATOR_CRONTAB: crontabMarker,
          PROC_ENTRY: procEntry,
          REMOTE_DIR: remoteDirectory,
          STAGING_DIR: stageDirectory,
          TMPDIR: transitionTmpDirectory,
          BACI_REMEDIATION_LEGACY_DRAIN_TIMEOUT_SECONDS:
            scenario === 'direct-exit' ||
            scenario === 'alternate-node-exit' ||
            scenario === 'flag-direct-exit'
              ? scenario === 'flag-direct-exit'
                ? '7'
                : '5'
              : '1',
          BACI_REMEDIATION_LEGACY_LOCK_WAIT_SECONDS:
            scenario === 'lock-timeout' ? '1' : '900',
          BACI_REMEDIATION_PROC_ROOT:
            scenario === 'proc-unavailable'
              ? join(directory, 'missing-proc')
              : procRoot,
          TEST_SCENARIO: scenario,
          VPS: 'test-vps',
          APP_SHA: deploySha,
        },
      }
    );
    return {
      crontab: existsSync(crontabMarker)
        ? readFileSync(crontabMarker, 'utf8')
        : '',
      temporaryEntries: readdirSync(transitionTmpDirectory),
      locks: existsSync(lockMarker)
        ? readFileSync(lockMarker, 'utf8').trim().split('\n')
        : [],
      remoteEntry: readFileSync(
        join(jobsDirectory, 'vercel-error-remediator.mjs'),
        'utf8'
      ),
      remoteFactory: existsSync(
        join(remoteDirectory, 'lib', 'remediation-worker-factory.mjs')
      )
        ? readFileSync(
            join(remoteDirectory, 'lib', 'remediation-worker-factory.mjs'),
            'utf8'
          )
        : '',
      barrierFiles:
        existsSync(
          join(remoteDirectory, 'lib/remediation-readonly-seccomp.mjs')
        ) &&
        existsSync(join(remoteDirectory, 'config/codex-readonly-seccomp.json')),
      result,
    };
  } finally {
    if (directProcessPid) {
      try {
        process.kill(Number(directProcessPid));
      } catch {
        // The drained child has already exited.
      }
    }
    rmSync(directory, { force: true, recursive: true });
  }
}
