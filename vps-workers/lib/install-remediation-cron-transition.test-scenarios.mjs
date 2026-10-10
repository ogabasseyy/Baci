import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  waitFor,
  writeExecutable,
  writeJob,
} from './install-remediation-cron-transition.test-fixtures.mjs';

// Split from install-remediation-cron-transition.test-helper.mjs: the
// legacy-direct-process scenario setup lives here so both modules stay
// under the 300-line limit.

export function spawnDirectScenarioProcess({
  binDirectory,
  crontabMarker,
  directReady,
  directory,
  jobsDirectory,
  procRoot,
  remoteDirectory,
  scenario,
}) {
  let directProcess;
  let directProcessPid;
  let procEntry = '';
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
  return { directProcessPid, procEntry };
}
