import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const releaseScript = join(
  dirname(fileURLToPath(import.meta.url)),
  'worker-release.sh'
);

function write(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, mode);
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const deployScript = `#!/usr/bin/env bash
cat <<EOF | ssh "$VPS" "cat > $STAGING_DIR/crontab.fragment"
$CRON_BLOCK_START
*/5 *  * * * flock -n $REMOTE_DIR/locks/gigl-tracking.lock bash -lc 'cd $REMOTE_DIR && $REMOTE_DIR/bin/process-gigl-tracking.sh' >> $REMOTE_DIR/logs/gigl-tracking.log 2>&1
*/2 * * * * flock -n $REMOTE_DIR/locks/cache-invalidations.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/run-cache-invalidation-cron.mjs' >> $REMOTE_DIR/logs/cache-invalidations.log 2>&1
40 3   * * * flock -n $REMOTE_DIR/locks/cleanup-remediation-storage.lock bash -lc 'cd $REMOTE_DIR && $NODE_BIN $REMOTE_DIR/jobs/cleanup-remediation-storage.mjs' >> $REMOTE_DIR/logs/cleanup-remediation-storage.log 2>&1
*/15 * * * * flock -n $REMOTE_DIR/locks/vercel-error-remediator.lock bash -lc 'export BACI_CODEX_DOCKER_IMAGE=$CODEX_REMEDIATOR_IMAGE && $NODE_BIN $REMOTE_DIR/jobs/vercel-error-remediator.mjs' >> $REMOTE_DIR/logs/r.log 2>&1
$CRON_BLOCK_END
EOF
`;

// A public-origin stand-in: a bare repo whose main holds the worker tree.
function createOrigin(base) {
  const work = join(base, 'origin-work');
  mkdirSync(work, { recursive: true });
  git(work, 'init', '--quiet', '-b', 'main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  write(join(work, 'vps-workers/deploy.sh'), deployScript);
  write(
    join(work, 'vps-workers/bin/process-gigl-tracking.sh'),
    '#!/usr/bin/env bash\n',
    0o755
  );
  write(join(work, 'vps-workers/jobs/preflight-direct-web-workers.mjs'), '');
  write(
    join(work, 'vps-workers/install-event-pipeline-services.sh'),
    'echo "events $1" >> "$HOME/services.log"\n'
  );
  write(
    join(work, 'vps-workers/install-quiz-finalization-service.sh'),
    'echo "quiz $1" >> "$HOME/services.log"\n'
  );
  write(join(work, '.github/scripts/gigl-dotenv.sh'), '# reader\n');
  write(join(work, 'apps/web/package.json'), '{}\n');
  write(join(work, '.gitignore'), 'node_modules\n');
  git(work, 'add', '-A');
  git(work, 'commit', '--quiet', '-m', 'first');
  const bare = join(base, 'origin.git');
  git(base, 'clone', '--quiet', '--bare', work, bare);
  return { work, bare };
}

function createStubs(base) {
  const bin = join(base, 'stubs');
  // pnpm: the app root install provides tsx; the worker install a marker.
  write(
    join(bin, 'pnpm'),
    `#!/usr/bin/env bash
# A hoisted install (marker file) puts tsx only at the workspace root.
tsx_dir=apps/web/node_modules/.bin; [ ! -e "$HOME/hoisted-tsx" ] || tsx_dir=node_modules/.bin
if [ -f apps/web/package.json ]; then mkdir -p "$tsx_dir" && printf '#!/bin/sh\\n' > "$tsx_dir/tsx" && chmod +x "$tsx_dir/tsx"; else mkdir -p node_modules; fi
`,
    0o755
  );
  write(
    join(bin, 'crontab'),
    '#!/usr/bin/env bash\nif [ -e "$HOME/fail-crontab" ]; then rm -f "$HOME/fail-crontab"; exit 1; fi\nif [ "$1" = -r ]; then rm -f "$HOME/installed-crontab"; else cp "$1" "$HOME/installed-crontab"; fi\n',
    0o755
  );
  write(
    join(bin, 'systemctl'),
    '#!/usr/bin/env bash\necho "$*" >> "$HOME/systemctl.log"\n',
    0o755
  );
  write(
    join(bin, 'node'),
    '#!/usr/bin/env bash\n[ ! -e "$HOME/fail-preflight" ] || exit 1\n# Like the real preflight: ../.env relative to the resolved script path.\n[ -r "$(dirname "$(readlink -f "$1")")/../.env" ] || exit 3\n',
    0o755
  );
  return bin;
}

export function createHost({ nodeFromPath = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'baci-worker-release-'));
  const origin = createOrigin(base);
  const stubs = createStubs(base);
  const root = join(base, 'root');
  write(join(root, 'baci-workers/.env'), 'BACI_REPO_DIR=x\n', 0o640);
  const env = {
    HOME: root,
    PATH: `${stubs}:${process.env.PATH}`,
    BACI_WORKER_ROOT: root,
    BACI_WORKER_ORIGIN: origin.bare,
    ...(nodeFromPath ? {} : { BACI_WORKER_NODE_BIN: join(stubs, 'node') }),
    BACI_WORKER_LOCK_WAIT_SECONDS: '5',
  };
  const run = (...args) =>
    spawnSync('bash', [releaseScript, ...args], { env, encoding: 'utf8' });
  const commit = (message, file = 'vps-workers/bin/extra.sh') => {
    write(join(origin.work, file), `# ${message}\n`, 0o755);
    git(origin.work, 'add', '-A');
    git(origin.work, 'commit', '--quiet', '-m', message);
    git(origin.work, 'push', '--quiet', origin.bare, 'HEAD:main');
    return git(origin.work, 'rev-parse', 'HEAD');
  };
  const sideCommit = () => {
    git(origin.work, 'checkout', '--quiet', '-b', 'side');
    write(join(origin.work, 'side.txt'), 'side\n');
    git(origin.work, 'add', '-A');
    git(origin.work, 'commit', '--quiet', '-m', 'side');
    git(origin.work, 'push', '--quiet', origin.bare, 'side');
    const sha = git(origin.work, 'rev-parse', 'HEAD');
    git(origin.work, 'checkout', '--quiet', 'main');
    return sha;
  };
  const resetMain = (sha) => {
    git(origin.work, 'reset', '--quiet', '--hard', sha);
    git(origin.work, 'push', '--quiet', '--force', origin.bare, 'HEAD:main');
  };
  const firstSha = git(origin.work, 'rev-parse', 'HEAD');
  const read = (path) => readFileSync(join(root, path), 'utf8');
  return { base, root, run, commit, sideCommit, resetMain, firstSha, read };
}
