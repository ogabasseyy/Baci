import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  quiesceHelper,
  readPromotionSource,
} from './deploy-promotion-guards.test-fixtures.mjs';

// Record-completion and rollback-anchor coverage lives in
// deploy-promotion-record-guards.test.mjs (split to keep both suites
// under the 300-line limit).

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

  it('restores the pre-promote tree when the checkout flip fails', () => {
    // The sync replaces bin/, jobs/, lib/, config/, dependencies, and
    // the SHA marker while app-live still points at the previous
    // checkout: if the flip then refuses (missing/invalid per-SHA
    // checkout), promote restores the pre-promote snapshot before the
    // quiesce EXIT trap restarts services — otherwise they resume
    // against a mixed release.
    const { promotionSource } = readPromotionSource();
    const snapshotIndex = promotionSource.indexOf('pre_promote_backup');
    assert.notEqual(snapshotIndex, -1);
    assert.ok(
      snapshotIndex < promotionSource.indexOf('rsync -a --delete'),
      'expected the snapshot before the live-tree sync'
    );
    assert.match(
      promotionSource,
      /for entry in bin jobs lib config node_modules/
    );
    assert.match(
      promotionSource,
      /if ! bash "\$staging_dir\/lib\/flip-immutable-checkout\.sh"/
    );
    const restoreIndex = promotionSource.indexOf(
      'restoring the pre-promote live tree'
    );
    assert.notEqual(restoreIndex, -1);
    assert.ok(
      restoreIndex > promotionSource.indexOf('flip-immutable-checkout.sh'),
      'expected the restore on the flip-failure path'
    );
    // Both legs converge: the backup is removed on success and after
    // a restore, and a crashed run's residue is cleared up front.
    assert.match(promotionSource, /rm -rf "\$pre_promote_backup"/);
  });
});
