import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(directory, '../..');
export const helper = join(directory, 'refresh-gigl-cutover-latch.sh');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}
function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

export function fixture(scope = 'enabled') {
  const root = mkdtempSync(join(tmpdir(), 'baci-refresh-gigl-latch-'));
  const remote = join(root, 'workers');
  const checkout = join(root, 'checkout');
  const fakeBin = join(root, 'test-bin');
  const cron = join(root, 'crontab');
  const state = join(root, 'state.json');
  const smokeRecord = join(root, 'smoke.json');
  const deployLock = join(root, 'deploy.lock');
  const trackingLock = join(remote, 'locks/gigl-tracking.lock');
  const latch = join(remote, '.gigl-capability-smoke-ok');
  const dotenv = join(remote, '.env');
  const oldLatch = `disabled:${'a'.repeat(40)}:${'b'.repeat(64)}\n`;
  for (const path of [
    fakeBin,
    checkout,
    join(remote, 'bin'),
    join(remote, 'jobs'),
    join(remote, 'locks'),
  ])
    mkdirSync(path, { recursive: true });
  git(checkout, 'init', '-q');
  writeFileSync(join(checkout, 'worker.txt'), 'installed\n');
  git(checkout, 'add', '.');
  git(
    checkout,
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    'commit',
    '-qm',
    'installed'
  );
  const sha = git(checkout, 'rev-parse', 'HEAD');
  writeFileSync(join(remote, 'app-checkout.sha'), `${sha}\n`);
  writeFileSync(latch, oldLatch);
  writeFileSync(state, '{}');
  const token = 'fixture-installed-token';
  const fingerprint = createHash('sha256')
    .update(
      'https://fixture.invalid\nanon-fixture\nhttps://provider.invalid\nfixture-user\nfixture-password\n' +
        token
    )
    .digest('hex');
  writeFileSync(
    dotenv,
    'BACI_REPO_DIR=' +
      checkout +
      '\nGIGL_ENABLED=' +
      (scope === 'disabled' ? 'false' : 'true') +
      '\nNEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon-fixture\nGIGL_BASE_URL=https://provider.invalid\nGIGL_EMAIL=fixture-user\nGIGL_PASSWORD=fixture-password\nGIGL_TRACKING_WORKER_TOKEN=' +
      token +
      '\n'
  );
  writeFileSync(
    cron,
    '*/5 * * * * flock -n ' +
      trackingLock +
      " bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=gigl-tracking && export GIGL_ENV_FILE_AUTHORITATIVE=1 && cd " +
      remote +
      ' && timeout --signal=TERM --kill-after=30s 2m ' +
      remote +
      "/bin/process-gigl-tracking.sh' >> " +
      remote +
      '/logs/gigl-tracking.log 2>&1\n'
  );
  executable(
    join(fakeBin, 'crontab'),
    `#!/usr/bin/env bash\ncat ${quote(cron)}\n`
  );
  executable(
    join(remote, 'bin/process-gigl-tracking.sh'),
    '#!/usr/bin/env bash\nexit 0\n'
  );
  for (const name of [
    'verify-gigl-tracking-worker-capability.sh',
    'gigl-tracking-scoped-env.sh',
  ])
    copyFileSync(
      join(repoRoot, 'vps-workers/bin', name),
      join(remote, 'bin', name)
    );
  copyFileSync(
    join(directory, 'gigl-dotenv.sh'),
    join(remote, 'bin/gigl-dotenv.sh')
  );
  // Real verifier/resolver/smoke and scoped wrapper; only external runtime,
  // preflight and crontab boundaries use hermetic fixtures.
  writeFileSync(
    join(remote, 'jobs/preflight-direct-web-workers.mjs'),
    "import { readFileSync } from 'node:fs';\nconst state = JSON.parse(readFileSync(" +
      JSON.stringify(state) +
      ", 'utf8'));\nprocess.exit(state.preflightFailed ? 1 : 0);\n"
  );
  executable(
    join(remote, 'bin/run-web-script.sh'),
    '#!/usr/bin/env bash\nexec node ' +
      quote(join(root, 'smoke-boundary.mjs')) +
      '\n'
  );
  const lockProbe =
    'import fcntl,sys\nf=open(sys.argv[1], "a")\ntry: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(0)\nsys.exit(1)';
  writeFileSync(
    join(root, 'smoke-boundary.mjs'),
    [
      "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
      "import { spawnSync } from 'node:child_process';",
      'const state = JSON.parse(readFileSync(' +
        JSON.stringify(state) +
        ', "utf8"));',
      'const locks = ' +
        JSON.stringify([deployLock, trackingLock]) +
        '.map((path) => spawnSync("python3", ["-c", ' +
        JSON.stringify(lockProbe) +
        ', path]).status === 0);',
      'writeFileSync(' +
        JSON.stringify(smokeRecord) +
        ', JSON.stringify({ locks, token: process.env.GIGL_TRACKING_WORKER_TOKEN, scope: process.env.GIGL_ENABLED, oldLatch: readFileSync(' +
        JSON.stringify(latch) +
        ', "utf8"), profile: process.env.BACI_WORKER_PROFILE }));',
      'if (state.action === "identity") appendFileSync(' +
        JSON.stringify(dotenv) +
        ', "\\nGIGL_TRACKING_WORKER_TOKEN=rotated-fixture-token\\n");',
      'if (state.action === "sha") writeFileSync(' +
        JSON.stringify(join(remote, 'app-checkout.sha')) +
        ', "c".repeat(40));',
      'if (state.action === "checkout") appendFileSync(' +
        JSON.stringify(join(checkout, 'worker.txt')) +
        ', "drift");',
      'if (state.action === "cron") writeFileSync(' +
        JSON.stringify(cron) +
        ', "");',
      'if (state.action === "preflight") writeFileSync(' +
        JSON.stringify(state) +
        ', JSON.stringify({ preflightFailed: true }));',
      'console.log("fixture-installed-token");',
      `console.error(${JSON.stringify(fingerprint)});`,
      'process.exit(state.exit ?? 0);',
    ].join('\n')
  );
  // macOS lacks util-linux flock. This fallback uses real kernel flock on
  // inherited descriptors, preserving the parent shell's lock lifetime.
  // Linux CI uses native flock; neither path mocks successful acquisition.
  if (
    spawnSync('flock', ['--version'], { encoding: 'utf8' }).error?.code ===
    'ENOENT'
  ) {
    executable(
      join(fakeBin, 'flock'),
      '#!/usr/bin/env python3\nimport fcntl, sys, time\nassert len(sys.argv) == 4 and sys.argv[1] == "-w"\nend = time.monotonic() + float(sys.argv[2])\nwhile True:\n    try:\n        fcntl.flock(int(sys.argv[3]), fcntl.LOCK_EX | fcntl.LOCK_NB)\n        sys.exit(0)\n    except BlockingIOError:\n        if time.monotonic() >= end:\n            sys.exit(1)\n        time.sleep(0.01)\n'
    );
  }
  const env = {
    ...process.env,
    BACI_EXPECTED_APP_SHA: sha,
    BACI_GIGL_LATCH_TEST_DEPLOY_LOCK: deployLock,
    BACI_GIGL_LATCH_LOCK_WAIT_SECONDS: '1',
    VPS_WORKER_REMOTE_DIR: remote,
    PATH: `${fakeBin}:${process.env.PATH}`,
    // Deliberate caller overrides must not override installed identity.
    GIGL_ENV_FILE_AUTHORITATIVE: '0',
    GIGL_ENABLED: 'caller-override',
    GIGL_TRACKING_WORKER_TOKEN: 'fixture-caller-token',
  };
  const run = (overrides = {}) =>
    spawnSync('bash', [helper], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...env, ...overrides },
    });
  return {
    root,
    remote,
    checkout,
    cron,
    state,
    smokeRecord,
    deployLock,
    trackingLock,
    latch,
    dotenv,
    oldLatch,
    sha,
    fingerprint,
    token,
    env,
    run,
    readLatch: () => readFileSync(latch, 'utf8'),
  };
}
