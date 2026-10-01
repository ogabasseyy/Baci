import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseHelper = readFileSync(
  join(workerRoot, 'lib', 'prepare-worker-release.sh'),
  'utf8'
);

describe('deploy crontab', () => {
  it('uses the resolved Node binary for systemd services', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const releasePreparationIndex = deployScript.indexOf(
      'prepare_worker_release'
    );
    const triggerServiceIndex = deployScript.indexOf(
      'Installing AI storefront trigger user service'
    );

    assert.match(releaseHelper, /NODE_BIN=\$\(ssh/);
    assert.notEqual(releasePreparationIndex, -1);
    assert.notEqual(triggerServiceIndex, -1);
    assert.ok(releasePreparationIndex < triggerServiceIndex);
    assert.doesNotMatch(deployScript, /ExecStart=\/usr\/bin\/node/);
    assert.match(
      deployScript,
      /ExecStart=\$NODE_BIN \$REMOTE_DIR\/jobs\/ai-storefront-trigger-server\.mjs/
    );
  });

  it('runs the staged direct-worker preflight before promotion and crontab', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const preflightFailureBlock =
      /if ! ssh "\$VPS" "cd '\$STAGING_DIR' && \$NODE_BIN '\$STAGING_DIR\/jobs\/preflight-direct-web-workers\.mjs'"; then[\s\S]*?echo "Direct-worker environment preflight failed; live worker files and crontab were not changed\." >&2[\s\S]*?exit 1[\s\S]*?fi/;
    const preflightMatch = releaseHelper.match(preflightFailureBlock);
    const promotionIndex = releaseHelper.indexOf(
      'Promoting validated worker files'
    );
    const crontabIndex = deployScript.indexOf(
      'Installing crontab entries on VPS'
    );

    assert.ok(preflightMatch);
    assert.notEqual(promotionIndex, -1);
    assert.notEqual(crontabIndex, -1);
    assert.ok(
      releaseHelper.indexOf(preflightMatch[0]) < promotionIndex,
      'the fail-closed preflight must run before live promotion'
    );
    assert.ok(deployScript.indexOf('prepare_worker_release') < crontabIndex);
    assert.ok(
      deployScript.indexOf('docker build') <
        deployScript.indexOf('promote_worker_release')
    );
    assert.ok(deployScript.indexOf('promote_worker_release') < crontabIndex);
  });

  it('builds the remediator image from staging before live promotion', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const buildIndex = deployScript.indexOf(
      'docker build -f $STAGING_DIR/Dockerfile.codex-remediator -t $CODEX_REMEDIATOR_IMAGE $STAGING_DIR'
    );
    const promotionIndex = deployScript.indexOf('promote_worker_release');

    assert.notEqual(buildIndex, -1);
    assert.notEqual(promotionIndex, -1);
    assert.ok(buildIndex < promotionIndex);
    assert.doesNotMatch(deployScript, /docker build -f \$REMOTE_DIR/);
    assert.doesNotMatch(
      deployScript,
      /docker build -f \$STAGING_DIR\/Dockerfile\.codex-remediator .* \$REMOTE_DIR/
    );
  });

  it('requires the remote worker checkout to match the deploying commit', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(deployScript, /APP_SHA=\$\(git rev-parse HEAD\)/);
    assert.match(releaseHelper, /git -C "\$repo_dir" rev-parse --verify HEAD/);
    assert.match(
      releaseHelper,
      /git -C "\$repo_dir" status --porcelain=v1 --untracked-files=all/
    );
    assert.match(
      releaseHelper,
      /Direct-worker checkout is dirty\.[\s\S]*?exit 1/
    );
    assert.match(
      releaseHelper,
      /if \[ "\$actual_sha" != "\$expected_sha" \]; then[\s\S]*?echo "Direct-worker checkout does not match the deploying commit\." >&2[\s\S]*?exit 1[\s\S]*?fi/
    );
    assert.match(
      releaseHelper,
      /apps\/web\/src\/scripts\/process-petrock-reconciliation\.ts/
    );
    assert.match(
      releaseHelper,
      /apps\/web\/src\/scripts\/process-quiz-finalization\.ts/
    );
    assert.match(
      releaseHelper,
      /tsx_bin="\$repo_dir\/apps\/web\/node_modules\/\.bin\/tsx"/
    );
    assert.match(
      releaseHelper,
      /tsx_bin="\$repo_dir\/node_modules\/\.bin\/tsx"/
    );
    assert.doesNotMatch(releaseHelper, /pnpm .*exec tsx/);
    assert.match(
      releaseHelper,
      /Direct-worker checkout is missing \$script_path\.[\s\S]*?exit 1/
    );
    assert.match(
      releaseHelper,
      /Direct-worker checkout is missing the reviewed web toolchain\.[\s\S]*?exit 1/
    );
    assert.match(
      releaseHelper,
      /"\$remote_dir\/bin\/process-petrock-reconciliation\.sh"/
    );
    assert.match(
      releaseHelper,
      /"\$remote_dir\/bin\/process-quiz-finalization\.sh"/
    );
    assert.match(
      releaseHelper,
      /if \[ ! -x "\$wrapper_path" \]; then[\s\S]*?Missing or non-executable direct-worker wrapper: \$wrapper_path[\s\S]*?exit 1/
    );
    assert.ok(
      deployScript.indexOf('prepare_worker_release') <
        deployScript.indexOf('Installing crontab entries on VPS')
    );
  });

  it('prints the required full-checkout path in the environment reminder', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(deployScript, /BACI_REPO_DIR=\/opt\/baci\/app/);
  });

  it('schedules the iOS live-build sync daily backstop through run-web-cron', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /30 9\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/ios-live-build-sync\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/ios-live-build-sync/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/ios-live-build-sync\.log 2>&1/
    );
  });

  it('schedules the Android live-build sync daily backstop through run-web-cron', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const androidCronLine = deployScript
      .split('\n')
      .find((line) => line.includes('/api/cron/android-live-build-sync'));

    assert.ok(androidCronLine);
    assert.match(
      androidCronLine,
      /^45 9\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/android-live-build-sync\.lock bash -lc 'cd \$REMOTE_DIR && \$NODE_BIN \$REMOTE_DIR\/jobs\/run-web-cron\.mjs \/api\/cron\/android-live-build-sync' >> \$REMOTE_DIR\/logs\/android-live-build-sync\.log 2>&1$/
    );
  });

  it('refreshes the GIGL service-centre directory outside checkout', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /15 4\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/sync-gigl-service-centres\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/sync-gigl-service-centres\.mjs/
    );
    assert.match(deployScript, /GIGL_BASE_URL=\.\.\./);
    assert.match(deployScript, /GIGL_EMAIL=\.\.\./);
    assert.match(deployScript, /GIGL_PASSWORD=\.\.\./);
  });

  it('serializes the AI storefront worker behind the shared workload lock', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /\*\/10 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/ollama-workload\.lock flock -n \$REMOTE_DIR\/locks\/ai-storefront-jobs\.lock/
    );
    assert.match(
      deployScript,
      /export NODE_ENV=production && export BACI_WORKER_PROFILE=ai-storefront-jobs/
    );
  });

  it('schedules the Supabase retention cleanup worker', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /20 3\s+\* \* \* flock -n \$REMOTE_DIR\/locks\/supabase-retention-cleanup\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/supabase-retention-cleanup\.mjs/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/supabase-retention-cleanup\.log 2>&1/
    );
  });

  it('schedules hourly cleanup for expired agentic request records', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /10\s+\*\s+\*\s+\*\s+\* flock -n \$REMOTE_DIR\/locks\/cleanup-agentic-request-records\.lock/
    );
    assert.match(
      deployScript,
      /\$NODE_BIN \$REMOTE_DIR\/jobs\/cleanup-agentic-request-records\.mjs/
    );
    assert.match(
      deployScript,
      />> \$REMOTE_DIR\/logs\/cleanup-agentic-request-records\.log 2>&1/
    );
  });

  it('keeps import job processing as an hourly fallback sweep', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(
      deployScript,
      /17\s+\*\s+\*\s+\*\s+\* flock -n \$REMOTE_DIR\/locks\/process-import-jobs\.lock/
    );
    assert.match(deployScript, /\$REMOTE_DIR\/bin\/process-import-jobs\.sh/);
    assert.doesNotMatch(
      deployScript,
      /2-59\/5 \* \* \* \* flock -n \$REMOTE_DIR\/locks\/process-import-jobs\.lock/
    );
  });

  it('installs event workers and one-minute flock-guarded recovery sweeps', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');

    assert.match(deployScript, /install-event-pipeline-services\.sh/);
    assert.match(
      deployScript,
      /^\* \* \* \* \* flock -n \$REMOTE_DIR\/locks\/process-domain-events\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd \$REMOTE_DIR && \$REMOTE_DIR\/bin\/process-domain-events\.sh --once' >> \$REMOTE_DIR\/logs\/process-domain-events\.log 2>&1$/m
    );
    assert.match(
      deployScript,
      /^\* \* \* \* \* flock -n \$REMOTE_DIR\/locks\/process-event-deliveries\.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd \$REMOTE_DIR && \$REMOTE_DIR\/bin\/process-event-deliveries\.sh --once' >> \$REMOTE_DIR\/logs\/process-event-deliveries\.log 2>&1$/m
    );
  });

  it('keeps the deployment entrypoint within the repository size limit', () => {
    const deployScript = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const lineCount = deployScript.endsWith('\n')
      ? deployScript.split('\n').length - 1
      : deployScript.split('\n').length;

    assert.ok(lineCount <= 300);
  });
});
