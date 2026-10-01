import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  crontabStub,
  flockStub,
  waitFor,
  writeExecutable,
  writeJob,
  writeStage,
} from './install-remediation-cron-transition.test-fixtures.mjs';

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
  if (
    scenario === 'custom-global-lock' ||
    scenario === 'custom-global-lock-export'
  ) {
    writeFileSync(
      join(remoteDirectory, '.env'),
      scenario === 'custom-global-lock-export'
        ? 'export BACI_REMEDIATION_GLOBAL_LOCK_PATH=locks/custom-global.lock # comment\n'
        : '  BACI_REMEDIATION_GLOBAL_LOCK_PATH = "locks/custom-global.lock" # comment\n'
    );
  }
  writeStage(
    stageDirectory,
    globalLockSource,
    transactionSource,
    crontabSource
  );
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
  let directProcess;
  let directProcessPid;
  let procEntry = '';
  try {
    if (
      scenario === 'direct-exit' ||
      scenario === 'direct-timeout' ||
      scenario === 'alternate-node-exit' ||
      scenario === 'flag-direct-exit' ||
      scenario === 'operator-prewrite' ||
      scenario === 'slow-startup' ||
      scenario === 'unsafe-option-target' ||
      scenario === 'unrelated-process' ||
      scenario === 'watchdog-argument'
    ) {
      const job =
        scenario === 'operator-prewrite'
          ? join(directory, 'operator-prewrite-process.mjs')
          : join(
              jobsDirectory,
              scenario === 'unrelated-process'
                ? 'unrelated-worker.mjs'
                : 'vercel-error-remediator.mjs'
            );
      const exitTimer =
        scenario === 'direct-timeout'
          ? 'setTimeout(() => {}, 5000);'
          : scenario === 'flag-direct-exit'
            ? 'setTimeout(() => rmSync(process.env.PROC_ENTRY, { force: true, recursive: true }), 5000);'
            : 'setTimeout(() => rmSync(process.env.PROC_ENTRY, { force: true, recursive: true }), 1500);';
      const ready =
        scenario === 'slow-startup'
          ? 'setTimeout(() => writeFileSync(process.env.DIRECT_READY, String(process.pid)), 2500);'
          : 'writeFileSync(process.env.DIRECT_READY, String(process.pid));';
      writeJob(
        job,
        `import { rmSync, writeFileSync } from 'node:fs'; ${ready} ${exitTimer}`
      );
      const command =
        scenario === 'alternate-node-exit'
          ? join(binDirectory, 'node')
          : process.execPath;
      writeExecutable(
        join(binDirectory, 'node'),
        `#!/usr/bin/env bash\nexec ${process.execPath} "$@"\n`
      );
      const args =
        scenario === 'watchdog-argument'
          ? [
              join(jobsDirectory, 'watchdog.mjs'),
              'jobs/vercel-error-remediator.mjs',
            ]
          : [
              scenario === 'alternate-node-exit'
                ? 'jobs/vercel-error-remediator.mjs'
                : job,
            ];
      if (scenario === 'watchdog-argument') {
        writeJob(
          join(jobsDirectory, 'watchdog.mjs'),
          "import { rmSync, writeFileSync } from 'node:fs'; writeFileSync(process.env.DIRECT_READY, String(process.pid)); setTimeout(() => rmSync(process.env.PROC_ENTRY, { force: true, recursive: true }), 1500);"
        );
      }
      const processDirectory = join(procRoot, '4242');
      procEntry = processDirectory;
      mkdirSync(processDirectory);
      writeFileSync(
        join(processDirectory, 'cmdline'),
        `node\0${scenario === 'watchdog-argument' ? 'jobs/watchdog.mjs\0jobs/vercel-error-remediator.mjs' : scenario === 'flag-direct-exit' ? '--no-warnings\0jobs/vercel-error-remediator.mjs' : scenario === 'unsafe-option-target' ? '--require\0jobs/vercel-error-remediator.mjs' : 'jobs/vercel-error-remediator.mjs'}\0`
      );
      symlinkSync(remoteDirectory, join(processDirectory, 'cwd'));
      symlinkSync(join(binDirectory, 'node'), join(processDirectory, 'exe'));
      if (
        scenario === 'watchdog-argument' ||
        scenario === 'unsafe-option-target'
      ) {
        writeFileSync(directReady, '0');
      } else {
        directProcess = spawn(command, args, {
          cwd: scenario === 'alternate-node-exit' ? remoteDirectory : undefined,
          env: {
            ...process.env,
            DIRECT_READY: directReady,
            INITIAL_CRONTAB_READ: join(directory, 'initial-crontab-read'),
            OPERATOR_CRONTAB: crontabMarker,
            PROC_ENTRY: processDirectory,
          },
          stdio: 'ignore',
        });
        directProcess.unref();
        waitFor(directReady);
        directProcessPid = readFileSync(directReady, 'utf8').trim();
      }
    }
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
