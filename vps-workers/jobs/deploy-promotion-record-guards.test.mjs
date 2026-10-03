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

  it('rolls back the promotion when the post-flip record fails', () => {
    // A failed refresh must not strand an unrecorded tree: deploy.sh
    // restores the pre-promote snapshot (tree + checkout pointer +
    // marker) and exits before the transition or any install runs —
    // superseding the old complete-installs behavior, which assumed
    // the flipped tree would stay live. The standing pre-flip record
    // is then complete again.
    const deploySource = readFileSync(join(workerRoot, 'deploy.sh'), 'utf8');
    const refreshIndex = deploySource.indexOf(
      'record_deploy_workflow_promote "$APP_SHA" ||'
    );
    const transitionIndex = deploySource.indexOf(
      'install_remediation_cron_transition'
    );
    assert.ok(refreshIndex !== -1 && transitionIndex !== -1);
    const failureSlice = deploySource.slice(refreshIndex, transitionIndex);
    assert.ok(
      failureSlice.includes('rollback_worker_release'),
      'expected rollback on refresh failure'
    );
    assert.ok(failureSlice.includes('exit 1'), 'expected exit after rollback');
    assert.match(failureSlice, /ROLLBACK FAILED/);
    assert.doesNotMatch(
      failureSlice,
      /Installing crontab entries/,
      'expected no installs between refresh failure and exit'
    );
    // The rollback restores the exact pre-promote state under the same
    // locks as promote: snapshot entries, marker, and (except first
    // deploys) the checkout pointer via the standard flip — leaving no
    // snapshot behind.
    const releaseSource = readFileSync(
      join(workerRoot, 'lib', 'prepare-worker-release.sh'),
      'utf8'
    );
    const rollbackSlice = releaseSource.slice(
      releaseSource.indexOf('rollback_worker_release()')
    );
    assert.match(
      rollbackSlice,
      /quiesce_worker_release "\$remote_dir" "\$staging_dir\/bin\/gigl-dotenv\.sh" \|\| exit 1/
    );
    assert.match(
      rollbackSlice,
      /for entry in bin jobs lib config node_modules/
    );
    assert.match(
      rollbackSlice,
      /flip-immutable-checkout\.sh" "\$remote_dir" "\$\(cat/
    );
    assert.match(rollbackSlice, /rm -rf "\$pre_promote_backup"/);
    // The promote snapshots the checkout pointer (.env + pre-flip link
    // target) so first-deploy rollback reverses the flip's one-time
    // legacy migration instead of stranding the rewritten .env and the
    // candidate symlink (legacy wrappers would execute candidate code
    // through it).
    assert.match(
      releaseSource,
      /cp -a "\$remote_dir\/\.env" "\$pre_promote_backup\/\.env"/
    );
    assert.match(releaseSource, /app-live-target/);
    // First-deploy rollback reverses the checkout pointer through the
    // flip's shared restore mode (same call as promote's flip-failure
    // handler: the flip can fail after repointing anywhere).
    assert.match(
      rollbackSlice,
      /flip-immutable-checkout\.sh" --restore-pointer/
    );
    // The promote snapshot survives success for exactly this path;
    // deploy.sh removes it once the refresh lands.
    assert.match(deploySource, /rm -rf '\$STAGING_DIR\.pre-promote-backup'/);
    // The failure branch only runs because the serialization
    // functions return instead of exiting (an exit inside a sourced
    // function would kill deploy.sh before the branch runs).
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

  it('isolates rollback snapshots between concurrent deploys', () => {
    // The deploy lock serializes promotes but releases before the
    // post-flip record and possible rollback, so a shared backup
    // would let a second deploy clobber the first's snapshot
    // mid-record. Each deployment owns its snapshot (named after the
    // unique staging dir) on both the promote and rollback legs;
    // orphaned snapshots retire by age only, never blindly.
    const releaseSource = readFileSync(
      join(workerRoot, 'lib', 'prepare-worker-release.sh'),
      'utf8'
    );
    const owned = releaseSource.match(
      /pre_promote_backup="\$\{staging_dir\}\.pre-promote-backup"/g
    );
    assert.equal(owned?.length, 2, 'expected owned snapshots on both legs');
    assert.doesNotMatch(
      releaseSource,
      /\$\{remote_dir\}\.pre-promote-backup/,
      'expected no shared snapshot path'
    );
    assert.match(releaseSource, /-name '\*\.pre-promote-backup' -mmin \+60/);
    // Rollback refuses when the live marker moved past this deploy's
    // SHA (a concurrent deploy landed): restoring then would wipe
    // the newer live tree.
    const rollbackSlice = releaseSource.slice(
      releaseSource.indexOf('rollback_worker_release()')
    );
    assert.match(rollbackSlice, /expected_sha="\$3"/);
    assert.match(
      rollbackSlice,
      /live_sha=.*app-checkout\.sha.*\nif \[ -n "\$live_sha" \] && \[ "\$live_sha" != "\$expected_sha" \]; then/
    );
    assert.match(rollbackSlice, /moved past this promote/);
  });

  it('records the rollback overlap before and after the restore', () => {
    // The manual rollback mirrors deploy.sh: a pre-restore record gate
    // (failure stops the operator before anything is mutated) plus a
    // post-restore refresh (failure leaves the pre-restore record
    // standing). Pin both one-liners and their order around the
    // restore block.
    const runbook = readFileSync(
      join(workerRoot, 'docs', 'gigl-tracking-cutover-runbook.md'),
      'utf8'
    );
    const preIndex = runbook.indexOf(
      'record_deploy_workflow_promote "<full-sha>" pre'
    );
    const restoreIndex = runbook.indexOf(
      'flock -x "$REMOTE_DIR/locks/gigl-tracking.lock" bash -c'
    );
    const postIndex = runbook.indexOf(
      'record_deploy_workflow_promote "<full-sha>"\''
    );
    assert.ok(preIndex !== -1 && restoreIndex !== -1 && postIndex !== -1);
    assert.ok(
      preIndex < restoreIndex && restoreIndex < postIndex,
      'expected pre-rollback record, then restore, then refresh'
    );
  });
});
