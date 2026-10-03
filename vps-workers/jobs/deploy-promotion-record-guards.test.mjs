import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { workerRoot } from './deploy-promotion-guards.test-fixtures.mjs';

// Split from deploy-promotion-guards.test.mjs: record-completion and
// rollback-anchor pins live here so both suites stay under 300 lines.

describe('deploy promotion record guards', () => {
  it('rewrites dotenv files via same-directory temp files', () => {
    // The flip and provisioner rewrite .env files holding secrets: a
    // /tmp temp on another filesystem would silently degrade the
    // final mv to copy+unlink, exposing a half-written .env to
    // concurrent readers. Same-directory temps keep it an atomic
    // rename.
    for (const [script, template] of [
      ['lib/flip-immutable-checkout.sh', '"$remote_dir/.env.XXXXXX"'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion compared verbatim.
      ['lib/provision-immutable-checkout.sh', '"${env_file}.XXXXXX"'],
    ]) {
      const source = readFileSync(join(workerRoot, script), 'utf8');
      assert.ok(
        source.includes(`mktemp ${template}`),
        `expected ${script} to mktemp beside its destination`
      );
      assert.doesNotMatch(
        source,
        /\$\(mktemp\)/,
        `expected no bare mktemp in ${script}`
      );
    }
  });

  it('completes installation when the promote record fails', () => {
    // deploy.sh runs under set -e with the record AFTER the flip: a
    // bare record call would exit there, leaving the live tree
    // without services or schedule. The record status is captured,
    // every install completes, and the deploy fails honestly at the
    // end (before the "Done" marker, so success is never printed on
    // a failed deploy).
    const deploySource = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const captureIndex = deploySource.indexOf(
      'record_deploy_workflow_promote "$APP_SHA" || record_status=$?'
    );
    const installIndex = deploySource.indexOf(
      '==> Installing crontab entries on VPS'
    );
    const failIndex = deploySource.indexOf(
      'if [ "$record_status" -ne 0 ]; then'
    );
    const doneIndex = deploySource.indexOf('echo "==> Done."');
    assert.ok(
      captureIndex !== -1 &&
        installIndex !== -1 &&
        failIndex !== -1 &&
        doneIndex !== -1
    );
    assert.ok(
      captureIndex < installIndex &&
        installIndex < failIndex &&
        failIndex < doneIndex,
      'expected record-capture, then installs, then end-failure, then Done'
    );
    assert.match(deploySource, /exit "\$record_status"/);
    // The capture only works because the serialization functions
    // return instead of exiting (an exit inside a sourced function
    // would kill deploy.sh before the capture runs).
    const libSource = readFileSync(
      join(workerRoot, 'lib', 'check-deploy-workflow-inflight.sh'),
      'utf8'
    );
    for (const line of libSource.split('\n')) {
      assert.doesNotMatch(
        line,
        /^\s*exit(\s|;|$)/,
        'expected no exit commands in the serialization lib (return, never exit)'
      );
    }
  });

  it('keeps the rollback crontab-restore anchors in deploy.sh', () => {
    // The emergency rollback renders the target rev's crontab fragment
    // from its deploy.sh and runs its merge script in-flock. Both are
    // anchor-extracted (template lines, heredoc delimiters, marker
    // assignments): a deploy.sh refactor that renames any anchor
    // silently breaks rollback, so pin each exactly-once and ordered.
    const source = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const count = (pattern) =>
      source.split('\n').filter((line) => pattern.test(line)).length;

    assert.equal(
      count(/^\$CRON_BLOCK_START$/),
      1,
      'expected one template-start line'
    );
    assert.equal(
      count(/^\$CRON_BLOCK_END$/),
      1,
      'expected one template-end line'
    );
    assert.ok(
      source.indexOf('$CRON_BLOCK_START') < source.indexOf('$CRON_BLOCK_END'),
      'expected the template to open before it closes'
    );
    assert.equal(
      count(/^CRON_BLOCK_START=/),
      1,
      'expected one block-start assignment'
    );
    assert.equal(
      count(/^CRON_BLOCK_END=/),
      1,
      'expected one block-end assignment'
    );
    assert.equal(
      count(/<<'REMOTE_SH'/),
      1,
      'expected one merge-script heredoc open'
    );
    assert.equal(count(/^REMOTE_SH$/), 1, 'expected one merge-script close');
    assert.ok(
      source.indexOf("<<'REMOTE_SH'") < source.indexOf('\nREMOTE_SH\n'),
      'expected the merge script to open before it closes'
    );
    // The rollback render replicates deploy-time expansion of exactly
    // these variables; a new heredoc variable must be added to the
    // runbook render step (the unexpanded-line guard would catch it,
    // but only mid-emergency).
    const template = source.slice(
      source.indexOf('$CRON_BLOCK_START'),
      source.indexOf('$CRON_BLOCK_END') + '$CRON_BLOCK_END'.length
    );
    for (const variable of [
      '$REMOTE_DIR',
      '$NODE_BIN',
      '$CODEX_REMEDIATOR_IMAGE',
      '$CODEX_CONTAINER_BIN',
      '$CODEX_READONLY_SECCOMP_PROFILE',
      '$CRON_BLOCK_START',
      '$CRON_BLOCK_END',
    ]) {
      assert.ok(
        template.includes(variable),
        `expected the template to use ${variable}`
      );
    }
    const expansions = template.match(/\$[A-Za-z_]+/g) ?? [];
    assert.deepEqual(
      [...new Set(expansions)].sort(),
      [
        '$CODEX_CONTAINER_BIN',
        '$CODEX_READONLY_SECCOMP_PROFILE',
        '$CODEX_REMEDIATOR_IMAGE',
        '$CRON_BLOCK_END',
        '$CRON_BLOCK_START',
        '$NODE_BIN',
        '$REMOTE_DIR',
      ],
      'unexpected template variable: extend the rollback render step'
    );
  });
});
