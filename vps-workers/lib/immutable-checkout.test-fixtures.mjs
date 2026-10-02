import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const TS_ENTRYPOINTS = [
  'apps/web/src/scripts/process-gigl-tracking.ts',
  'apps/web/src/scripts/process-petrock-reconciliation.ts',
  'apps/web/src/scripts/process-quiz-finalization.ts',
];
const WRAPPERS = [
  'process-gigl-tracking.sh',
  'verify-gigl-tracking-worker-capability.sh',
  'process-petrock-reconciliation.sh',
  'process-quiz-finalization.sh',
];
const TSX_STUB = '#!/usr/bin/env bash\necho "tsx-stub"\n';

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'baci-test',
  GIT_AUTHOR_EMAIL: 'baci-test@example.com',
  GIT_COMMITTER_NAME: 'baci-test',
  GIT_COMMITTER_EMAIL: 'baci-test@example.com',
};

export function git(args, cwd, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnv, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let fixtureRoots = [];

export function cleanupImmutableCheckoutFixtures() {
  for (const root of fixtureRoots) {
    rmSync(root, { force: true, recursive: true });
  }
  fixtureRoots = [];
}

// Builds a fixture VPS layout: an origin repo with commits carrying
// distinct marker content, a legacy object-source clone, and worker
// staging/remote dirs. Every commit carries the TS entrypoints and a
// tsx stub unless withTsx is false for that commit.
export function immutableCheckoutFixture({ commits }) {
  // Resolve symlinks (macOS tmpdir): git prints canonical worktree
  // paths, and the GC registration check compares exact strings —
  // production bases (/home/..., /opt/...) are already canonical.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'baci-immutable-')));
  fixtureRoots.push(root);
  const origin = join(root, 'origin');
  mkdirSync(origin, { recursive: true });
  git(['init', '-b', 'main', '--quiet'], origin);

  const shas = [];
  for (const [index, commit] of commits.entries()) {
    writeFileSync(join(origin, 'marker.txt'), `revision-${index}\n`);
    for (const entrypoint of TS_ENTRYPOINTS) {
      const path = join(origin, entrypoint);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '// entrypoint\n');
    }
    if (commit.withTsx !== false) {
      const tsxPath = join(
        origin,
        'apps',
        'web',
        'node_modules',
        '.bin',
        'tsx'
      );
      mkdirSync(dirname(tsxPath), { recursive: true });
      writeFileSync(tsxPath, TSX_STUB);
      chmodSync(tsxPath, 0o755);
    }
    // A tracked marker simulates a completed prior install (production
    // markers are untracked-but-ignored inside node_modules, so the
    // provisioner dirty check never sees either form).
    if (commit.withInstallMarker !== false) {
      const markerPath = join(origin, 'node_modules', '.baci-deps-installed');
      mkdirSync(dirname(markerPath), { recursive: true });
      writeFileSync(markerPath, 'fixture-install-marker\n');
    }
    git(['add', '-A'], origin);
    git(
      ['commit', '--quiet', '--no-gpg-sign', '-m', `revision ${index}`],
      origin
    );
    shas.push(git(['rev-parse', 'HEAD'], origin));
  }

  const base = join(root, 'base');
  mkdirSync(base, { recursive: true });
  const legacy = join(base, 'app');
  git(['clone', '--quiet', origin, legacy], root);

  const staging = join(root, 'staging');
  mkdirSync(join(staging, 'bin'), { recursive: true });
  writeFileSync(join(staging, '.env'), `BACI_REPO_DIR=${legacy}\n`);
  for (const wrapper of WRAPPERS) {
    const path = join(staging, 'bin', wrapper);
    writeFileSync(path, '#!/usr/bin/env bash\n');
    chmodSync(path, 0o755);
  }

  const remote = join(root, 'remote');
  mkdirSync(remote, { recursive: true });
  writeFileSync(join(remote, '.env'), `BACI_REPO_DIR=${legacy}\n`);

  return { base, legacy, origin, remote, root, staging, shas };
}

// Stubs pnpm so provision runs stay hermetic: every invocation is logged
// and the stub links a tsx executable exactly like a real install would
// (the provisioner itself writes the success marker afterwards).
export function stubPnpmCalls(root) {
  const binDir = join(root, 'stub-bin');
  mkdirSync(binDir, { recursive: true });
  const pnpmLog = join(root, 'pnpm-calls.log');
  writeFileSync(
    join(binDir, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      'echo "$*" >> "$PNPM_CALLS_LOG"',
      'echo "PUPPETEER_SKIP_DOWNLOAD=$PUPPETEER_SKIP_DOWNLOAD" >> "$PNPM_CALLS_LOG"',
      'mkdir -p apps/web/node_modules/.bin',
      "printf '#!/usr/bin/env bash\\necho tsx-stub\\n' > apps/web/node_modules/.bin/tsx",
      'chmod +x apps/web/node_modules/.bin/tsx',
      '',
    ].join('\n')
  );
  chmodSync(join(binDir, 'pnpm'), 0o755);
  return { pnpmLog, stubPath: `${binDir}:${process.env.PATH ?? ''}` };
}

export function runCheckoutScript(script, args, extraEnv = {}) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...gitEnv, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim(),
  };
}
