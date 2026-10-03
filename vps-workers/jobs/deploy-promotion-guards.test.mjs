import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseHelper = join(workerRoot, 'lib', 'prepare-worker-release.sh');

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

    // Lock names come from the installed crontab (promote runs before
    // the crontab install, so these are exactly the entries that can
    // tick) plus any lock file already present: no enumerated list to
    // drift when workers are added.
    assert.match(
      promotionSource,
      /crontab -l.*locks\/\[A-Za-z0-9_.-\]\+\\.lock/
    );
    assert.match(promotionSource, /locks\/\*\.lock/);
    // Acquisition order is crontab first-appearance (order-preserving
    // dedup), matching the ollama-first nesting shared by the cron
    // lines and the AI trigger server, so no deadlock cycle forms.
    assert.match(promotionSource, /awk '!seen\[\$0\]\+\+'/);
    // Each lock is held exclusive on an open fd (released only when
    // the remote shell exits after the flip), acquired before the sync,
    // with a bounded wait so a wedged tick fails loudly.
    const quiesceIndex = promotionSource.indexOf(
      'flock -w 600 -x "$gigl_quiesce_fd"'
    );
    assert.notEqual(quiesceIndex, -1);
    // The outer command already holds the GIGL lock: reopening it would
    // self-deadlock (flock is per open-file-description, not recursive).
    assert.match(
      promotionSource,
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
        promotionSource.includes(service),
        `expected promote to manage ${service}`
      );
    }
    assert.match(promotionSource, /trap gigl_restart_services EXIT/);
    assert.match(promotionSource, /is-active -q "\$gigl_service"/);
    const stopIndex = promotionSource.indexOf('systemctl --user stop');
    assert.ok(stopIndex !== -1 && stopIndex < quiesceIndex);
    assert.ok(quiesceIndex < promotionSource.indexOf('rsync -a --delete'));
    assert.ok(
      promotionSource.indexOf('rsync -a --delete') <
        promotionSource.indexOf('flip-immutable-checkout.sh')
    );
  });

  it('acquires remediation per-job locks before their shared global lock', () => {
    const { promotionSource } = readPromotionSource();

    // The remediation cron lines nest flock per-job (outer) -> global
    // (inner), but crontab first-appearance lists the global lock
    // (first seen on the vercel line) before the later per-job locks.
    // The canary waits up to 600s on its inner global take, so
    // promotion must defer the global lock past every per-job lock or
    // it deadlocks against a canary tick for the full timeout.
    const dedupIndex = promotionSource.indexOf("awk '!seen[$0]++'");
    const deferIndex = promotionSource.indexOf(
      '$0 == "error-remediator-global.lock"'
    );
    assert.ok(dedupIndex !== -1 && deferIndex !== -1);
    assert.ok(
      dedupIndex < deferIndex,
      'expected the global-lock deferral to run after first-appearance dedup'
    );
    assert.match(
      promotionSource,
      /\$0 == "error-remediator-global\.lock" \{ hold_global = 1; next \}/
    );
    assert.match(
      promotionSource,
      /END \{ if \(hold_global\) print "error-remediator-global\.lock" \}/
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
});
