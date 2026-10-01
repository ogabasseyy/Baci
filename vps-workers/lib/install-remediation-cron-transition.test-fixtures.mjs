import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

export function writeJob(path, source = 'process.exitCode = 0;\n') {
  writeFileSync(path, source);
}

export function waitFor(path) {
  const waiter = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (existsSync(path)) return;
    Atomics.wait(waiter, 0, 0, 10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

export function flockStub() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-x" ] && [ "$2" = "/tmp/baci-workers-deploy.lock" ]; then
  shift 2
  exec "$@"
fi
if [ "$1" = "-w" ]; then shift 2; fi
if [ "$1" = "-x" ]; then
  if [ "$TEST_SCENARIO" = "lock-timeout" ] && [ "$2" = "7" ]; then exit 73; fi
  if [ "$2" = "6" ]; then
    touch "$BARRIER_MARKER"
    printf '%s\n' "\${BACI_REMEDIATION_LOCK_PATH:-$2}" >> "$LOCK_MARKER"
  else
    printf '%s\n' "\${BACI_REMEDIATION_LOCK_PATH:-$2}" >> "$LOCK_MARKER"
  fi
fi
`;
}

export function crontabStub() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "-r" ]; then
  if [ "$TEST_SCENARIO" = "rollback-remove-error" ]; then
    echo "permission denied removing crontab" >&2
    exit 1
  fi
  rm -f "$CRONTAB_MARKER"
  exit 0
fi
if [ "$1" = "-l" ]; then
  if grep -q BARRIER_MARKER "$REMOTE_DIR/jobs/vercel-error-remediator.mjs" && { [ "$TEST_SCENARIO" = "launch-race" ] || [ "$TEST_SCENARIO" = "rollback" ]; }; then
    set +e
    node "$REMOTE_DIR/jobs/vercel-error-remediator.mjs"
    status="$?"
    set -e
    if [ "$status" -ne 75 ]; then
      echo "new direct launch escaped the transition barrier" >&2
      exit 92
    fi
  fi
  if [ -f "$CRONTAB_MARKER" ]; then
    if [ "$TEST_SCENARIO" = "rollback-remove-error" ] && [ ! -f "$ROLLBACK_READ_ERROR_MARKER" ]; then
      touch "$ROLLBACK_READ_ERROR_MARKER"
      echo "crontab spool unavailable" >&2
      exit 2
    fi
    cat "$CRONTAB_MARKER"
    exit 0
  fi
  case "$TEST_SCENARIO" in
    no-crontab|rollback-remove-error)
      echo "no crontab for test-user" >&2
      exit 1
      ;;
    read-error)
      echo "permission denied" >&2
      exit 2
      ;;
    operator-prewrite)
      echo "0 1 * * * /usr/local/bin/unrelated-worker"
      echo "* * * * * /usr/local/bin/operator-prewrite" > "$CRONTAB_MARKER"
      ;;
    preserve-unrelated)
      echo "# watchdog mentions jobs/vercel-error-remediator.mjs"
      echo "* * * * * node jobs/watchdog.mjs jobs/vercel-error-remediator.mjs"
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'cd $CANONICAL_REMOTE_DIR && $NODE_BIN $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      ;;
    retained-percent)
      echo '0 0 * * * date +\\%F'
      echo '1 0 * * * printf "payload%value"'
      ;;
    legacy-two-flock)
      echo "# keep this watchdog note about remediation"
      echo "* * * * * node jobs/watchdog.mjs jobs/vercel-error-remediator.mjs"
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock flock -n -E 75 $CANONICAL_REMOTE_DIR/locks/error-remediator-global.lock bash -lc 'export BACI_REMEDIATION_GLOBAL_FLOCK_HELD=1 BACI_CODEX_DOCKER_IMAGE=baci/codex:live && cd $CANONICAL_REMOTE_DIR && $NODE_BIN $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      echo "*/5 *  * * * flock -n $CANONICAL_REMOTE_DIR/locks/sentry-mobile-error-remediator.lock flock -n -E 75 $CANONICAL_REMOTE_DIR/locks/error-remediator-global.lock bash -lc 'cd $CANONICAL_REMOTE_DIR && $NODE_BIN $CANONICAL_REMOTE_DIR/jobs/sentry-mobile-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/sentry-mobile-error-remediator.log 2>&1"
      echo "22 4   * * * flock -n $CANONICAL_REMOTE_DIR/locks/remediation-codex-canary.lock flock -w 600 -E 75 $CANONICAL_REMOTE_DIR/locks/error-remediator-global.lock bash -lc 'export BACI_REMEDIATION_GLOBAL_FLOCK_HELD=1 && cd $CANONICAL_REMOTE_DIR && $NODE_BIN $CANONICAL_REMOTE_DIR/jobs/remediation-codex-canary.mjs' >> $CANONICAL_REMOTE_DIR/logs/remediation-codex-canary.log 2>&1"
      ;;
    legacy-node-change)
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'cd $CANONICAL_REMOTE_DIR && /opt/old-node/bin/node $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      ;;
    legacy-wrapper)
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'cd $CANONICAL_REMOTE_DIR && /usr/local/bin/audit-wrapper $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      ;;
    detached-lock)
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock true; bash -lc 'cd $CANONICAL_REMOTE_DIR && $NODE_BIN $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      ;;
    relative-node)
      echo "*/15 * * * * flock -n $CANONICAL_REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'cd $CANONICAL_REMOTE_DIR && ./node $CANONICAL_REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $CANONICAL_REMOTE_DIR/logs/vercel-error-remediator.log 2>&1"
      ;;
    *)
      echo "0 1 * * * /usr/local/bin/unrelated-worker"
      ;;
  esac
  exit 0
fi
if [ "$TEST_SCENARIO" = "interleaving" ] && [ "$(wc -l < "$LOCK_MARKER")" -lt 4 ]; then
  echo "transaction locks were not all held before the crontab rewrite" >&2
  exit 88
fi
if [ "$TEST_SCENARIO" = "rollback" ]; then
  exit 91
fi
if { [ "$TEST_SCENARIO" = "direct-exit" ] || [ "$TEST_SCENARIO" = "alternate-node-exit" ] || [ "$TEST_SCENARIO" = "flag-direct-exit" ]; } && [ -d "$PROC_ENTRY" ]; then
  echo "legacy direct process was still active at crontab rewrite" >&2
  exit 89
fi
if [ "$TEST_SCENARIO" = "operator-change" ]; then
  echo "* * * * * /usr/local/bin/operator-change" > "$CRONTAB_MARKER"
else
  cp "$1" "$CRONTAB_MARKER"
fi
`;
}

export function writeStage(
  stageDirectory,
  globalLockSource,
  transactionSource,
  crontabSource
) {
  const jobs = join(stageDirectory, 'jobs');
  const lib = join(stageDirectory, 'lib');
  const config = join(stageDirectory, 'config');
  mkdirSync(jobs, { recursive: true });
  mkdirSync(lib, { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(lib, 'remediation-global-lock.mjs'),
    readFileSync(globalLockSource)
  );
  writeFileSync(
    join(lib, 'remediation-cron-transition.py'),
    readFileSync(transactionSource)
  );
  writeFileSync(
    join(lib, 'remediation_cron_transition_crontab.py'),
    readFileSync(crontabSource)
  );
  writeFileSync(
    join(lib, 'remediation-worker.mjs'),
    "import './remediation-worker-factory.mjs';\nexport const runRemediationWorker = () => 'new';\n"
  );
  writeFileSync(
    join(lib, 'remediation-worker-factory.mjs'),
    'export const factoryLoaded = true;\n'
  );
  writeFileSync(join(lib, 'remediation-readonly-seccomp.mjs'), 'export {};\n');
  writeFileSync(join(config, 'codex-readonly-seccomp.json'), '{}\n');
  for (const name of [
    'vercel-error-remediator',
    'sentry-mobile-error-remediator',
    'remediation-codex-canary',
  ]) {
    writeJob(
      join(jobs, `${name}.mjs`),
      "import { existsSync } from 'node:fs';\nimport { runRemediationWorker } from '../lib/remediation-worker.mjs';\nif (typeof runRemediationWorker !== 'function') throw new Error('worker contract missing');\nprocess.exitCode = existsSync(process.env.BARRIER_MARKER) ? 75 : 0;\n"
    );
  }
}
