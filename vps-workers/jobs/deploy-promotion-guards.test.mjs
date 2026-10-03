import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseHelper = join(workerRoot, 'lib', 'prepare-worker-release.sh');
const quiesceHelper = join(workerRoot, 'lib', 'quiesce-worker-release.sh');

function readPromotionSource() {
  const source = readFileSync(releaseHelper, 'utf8');
  const promotionStart = source.indexOf(
    'flock -x /tmp/baci-workers-deploy.lock'
  );
  const promotionEnd = source.indexOf('REMOTE_SH\n\n', promotionStart);

  assert.notEqual(promotionStart, -1);
  return {
    promotionSource: source.slice(promotionStart, promotionEnd),
    source,
  };
}

describe('deploy promotion guards', () => {
  it('serializes live promotion and runtime-directory creation under one lock', () => {
    const { promotionSource, source } = readPromotionSource();

    assert.match(promotionSource, /rsync -a --delete/);
    assert.match(promotionSource, /mkdir -p.*logs.*locks/);
    // The checkout flip shares the deploy lock with the file promote,
    // so wrappers, SHA marker, and executed code change together.
    assert.match(
      promotionSource,
      /lib\/flip-immutable-checkout\.sh" "\$remote_dir" "\$expected_sha"/
    );
    // Promote nests the GIGL runtime lock inside the deploy lock, so a
    // cron tick (non-blocking) skips instead of running mixed-revision
    // wrappers against the pre-flip checkout. The slice starts at the
    // deploy lock, so the nested lock on the same command line is in it;
    // the locks-dir pre-create sits before the slice and pins separately.
    assert.match(
      promotionSource,
      /flock -x '\$REMOTE_DIR\/locks\/gigl-tracking\.lock'/
    );
    assert.match(
      source,
      /mkdir -p '\$REMOTE_DIR\/locks' && flock -x \/tmp\/baci-workers-deploy\.lock/
    );
  });

  it('quiesces every scheduled worker lock across the sync and flip', () => {
    const { promotionSource } = readPromotionSource();
    // The quiesce logic lives in the shared helper (also used by
    // emergency rollback); promote sources it from staging (the
    // revision being installed, so newly added services are covered)
    // and calls it before the sync.
    const quiesceSource = readFileSync(quiesceHelper, 'utf8');
    assert.match(
      promotionSource,
      /\.\s"\$staging_dir\/lib\/quiesce-worker-release\.sh"/
    );
    const callIndex = promotionSource.indexOf(
      'quiesce_worker_release "$remote_dir"'
    );
    assert.notEqual(callIndex, -1);
    assert.ok(callIndex < promotionSource.indexOf('rsync -a --delete'));

    // Lock names come from the installed crontab (promote runs before
    // the crontab install, so these are exactly the entries that can
    // tick) plus any lock file already present: no enumerated list to
    // drift when workers are added.
    assert.match(quiesceSource, /crontab -l.*locks\/\[A-Za-z0-9_.-\]\+\\.lock/);
    assert.match(quiesceSource, /locks\/\*\.lock/);
    // Acquisition order is crontab first-appearance (order-preserving
    // dedup), matching the ollama-first nesting shared by the cron
    // lines and the AI trigger server, so no deadlock cycle forms.
    assert.match(quiesceSource, /awk '!seen\[\$0\]\+\+'/);
    // Each lock is held exclusive on an open fd (released only when
    // the remote shell exits after the flip), acquired before the sync,
    // with a bounded wait so a wedged tick fails loudly.
    const quiesceIndex = quiesceSource.indexOf(
      'flock -w 600 -x "$gigl_quiesce_fd"'
    );
    assert.notEqual(quiesceIndex, -1);
    // The outer command already holds the GIGL lock: reopening it would
    // self-deadlock (flock is per open-file-description, not recursive).
    assert.match(
      quiesceSource,
      /\[\s*"\$gigl_quiesce_name"\s*=\s*"gigl-tracking\.lock"\s*\] && continue/
    );
    // Persistent `--loop` systemd services hold their locks for life,
    // so promote stops the active ones before quiescing; an EXIT trap
    // restarts exactly those after the flip, including on abort paths.
    for (const service of [
      'baci-domain-event-router',
      'baci-event-delivery-worker',
      'baci-quiz-finalization',
    ]) {
      assert.ok(
        quiesceSource.includes(service),
        `expected promote to manage ${service}`
      );
    }
    assert.match(quiesceSource, /trap gigl_restart_services EXIT/);
    assert.match(quiesceSource, /is-active -q "\$gigl_service"/);
    const stopIndex = quiesceSource.indexOf('systemctl --user stop');
    assert.ok(stopIndex !== -1 && stopIndex < quiesceIndex);
    assert.ok(
      promotionSource.indexOf('rsync -a --delete') <
        promotionSource.indexOf('flip-immutable-checkout.sh')
    );
  });

  it('acquires remediation per-job locks before their shared global lock', () => {
    // Lives in the shared quiesce helper (see above).
    const quiesceSource = readFileSync(quiesceHelper, 'utf8');

    // The remediation cron lines nest flock per-job (outer) -> global
    // (inner), but crontab first-appearance lists the global lock
    // (first seen on the vercel line) before the later per-job locks.
    // The canary waits up to 600s on its inner global take, so
    // promotion must defer the global lock past every per-job lock or
    // it deadlocks against a canary tick for the full timeout. The
    // deferred path is the CONFIGURED global lock (absolute and
    // outside-locks/ relatives included), not the hardcoded default: a
    // renamed global lock nests the same way and would deadlock the
    // same way unordered — and holding locks/<basename> instead of
    // the real path would let a directly launched remediator execute
    // mid-promote.
    const resolveIndex = quiesceSource.indexOf(
      "'BACI_REMEDIATION_GLOBAL_LOCK_PATH'"
    );
    assert.ok(
      resolveIndex !== -1,
      'expected the configured global lock to be resolved from the live .env'
    );
    assert.match(
      quiesceSource,
      /gigl_global_lock="error-remediator-global\.lock"/
    );
    // Absolute values pass through; relatives join under the remote
    // dir (the transition installer's three-way resolution).
    assert.match(quiesceSource, /\[\[ "\$gigl_global_value" = \/\* \]\]/);
    const dedupIndex = quiesceSource.indexOf("awk '!seen[$0]++'");
    const deferIndex = quiesceSource.indexOf(
      '$0 == gigl_global { hold_global = 1; next }'
    );
    assert.ok(dedupIndex !== -1 && deferIndex !== -1);
    assert.ok(
      resolveIndex < dedupIndex && dedupIndex < deferIndex,
      'expected global-lock resolution, then first-appearance dedup, then the deferral'
    );
    assert.match(quiesceSource, /awk -v gigl_global="\$gigl_defer_name"/);
    assert.match(
      quiesceSource,
      /END \{ if \(hold_global\) print gigl_global \}/
    );
    // An outside-locks/ path is held exactly, after the name loop
    // (deferred-last by construction), with a same-inode guard so a
    // locks/../locks/x.lock spelling does not self-deadlock on two
    // fds. The path is %q-escaped for the eval (operator-configured,
    // may contain spaces).
    const loopEndIndex = quiesceSource.indexOf('$gigl_quiesce_names\nEOF');
    const exactHoldIndex = quiesceSource.indexOf(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion compared verbatim.
      'exec ${gigl_quiesce_fd}>>$gigl_global_path_q'
    );
    assert.ok(loopEndIndex !== -1 && exactHoldIndex !== -1);
    assert.ok(
      loopEndIndex < exactHoldIndex,
      'expected the exact global-path hold to run after the name loop'
    );
    assert.match(
      quiesceSource,
      /"\$gigl_global_path" -ef "\$remote_dir\/locks\/\$gigl_global_lock"/
    );
    assert.match(
      quiesceSource,
      /printf -v gigl_global_path_q '%q' "\$gigl_global_path"/
    );
  });

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
