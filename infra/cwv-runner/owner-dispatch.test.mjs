// biome-ignore-all format: exact source-contract assertions remain dense below the file limit
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TASK9_SOURCE_FILES } from './task9-bootstrap.mjs';

const source = await readFile(
  new URL('./owner-dispatch.sh', import.meta.url),
  'utf8'
);

test('verifies the exact source inventory emitted by the Task 9 bootstrap receipt', () => {
  const dispatchSources = source
    .match(/readonly TASK9_SOURCES='([^']+)'/)?.[1]
    .split(' ');

  assert.deepEqual(dispatchSources, TASK9_SOURCE_FILES);
});

test('uses closed Task 9 bootstrap and transport state initialization interfaces', () => {
  assert.match(source, /--initialize-task9-state/);
  assert.match(source, /--initialize-state --source-authorization/);
  assert.match(source, /--bootstrap-task9/);
  assert.match(source, /--authorize --bundle-id "\$bundle_id" --reviewed-envelope-sha256 "\$reviewed_envelope_sha" --reviewed-launcher-sha256 "\$reviewed_launcher_sha" --bundle-dir/);
  assert.match(source, /task9-bootstrap-runtime\.mjs[\s\S]*task9-bootstrap-launcher\.mjs[\s\S]*\/bin\/chmod 0400 "\$launcher"/);
  assert.match(source, /"\$node" "\$launcher" --authorize/);
  assert.doesNotMatch(source, /"\$node" "\$bootstrap" --authorize/);
  assert.match(source, /adopt_task9_node "\$bundle"/);
  assert.match(source, /\/bin\/cp -p -- "\$node" "\$transaction_dir\/tools\/node\/bin\/node"/);
  assert.match(source, /prepare_task9_bootstrap_node\(\)/);
  assert.match(source, /--prepare-task9-bootstrap-node --root "\$transaction_dir" --policy "\$policy" --reviewed-policy-sha256 "\$reviewed_policy_sha"/);
  assert.doesNotMatch(source, /\(task9-node\).*prepare_gh/);
  assert.match(source, /"--operation",operation,"--state",state/);
  assert.doesNotMatch(source, /--operation "\$@"/);
  assert.match(source, /owner-api-transport-source\.mjs/);
  assert.match(source, /sourceFiles\.\$index\.path/);
  assert.doesNotMatch(source, /sourceHashes\.\$index\.path/);
  assert.match(source, /verify_task9_sources; manifest_sha=\$task9_manifest_sha\n {2}# shellcheck disable=SC2016,SC2094\n {2}\( verifier_status=/);
  assert.match(source, /task9-verifier-status\.XXXXXX[\s\S]*set \+e[\s\S]*--emit-task9-token[\s\S]*"--token-fd","0"[\s\S]*verifier_code/);
  assert.doesNotMatch(source, /task9-token\.|<"\$token"|>"\$token"/);
});

test('uses the adopted Task 9 Node receipt from bootstrap through initialization and operations', () => {
  const bootstrap = source.match(/bootstrap_task9\(\) \{[\s\S]*?\n\}/)?.[0];
  const initialize = source.match(/initialize_task9\(\) \{[\s\S]*?\n\}/)?.[0];
  const operation = source.match(/task9\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(bootstrap && initialize && operation);
  assert.match(bootstrap, /adopt_task9_node "\$bundle"/);
  assert.match(initialize, /verify_task9_node; verify_source_binding task9-exact-run/);
  assert.doesNotMatch(initialize, /verify_node/);
  assert.match(operation, /verify_task9_node[\s\S]*verify_source_binding task9-exact-run/);
  assert.doesNotMatch(operation, /verify_node/);
});

test('publishes Task 9 only into its authorized tree then freshly prepares the pinned CLI before token access', () => {
  const bootstrap = source.match(/bootstrap_task9\(\) \{[\s\S]*?\n\}/)?.[0];
  const task9Preparation = source.match(/prepare\(\) \{[\s\S]*?\n\}/)?.[0];
  const task9Operation = source.match(/task9\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(bootstrap && task9Preparation && task9Operation);
  assert.doesNotMatch(bootstrap, /--publish-dir|task9-published/);
  assert.match(bootstrap, /--prepare-task9-cli --transaction-dir "\$transaction_dir" --policy "\$transaction_dir\/authorized-source\/infra\/cwv-runner\/policy\.json" --source-authorization "\$transaction_dir\/authorized-source\/source-authorization\.json" --source-authorization-sha256 "\$transaction_dir\/authorized-source\/source-authorization\.sha256"/);
  assert.match(task9Preparation, /\(task9-cli\)[\s\S]*verify_source_binding task9-exact-run[\s\S]*verify_task9_manifest[\s\S]*prepare_gh[\s\S]*--purpose task9-exact-run --verify-only/);
  assert.doesNotMatch(task9Operation, /\bfetch\(/);
});

test('hash-binds and delegates Task 9 composition to the focused helper', () => {
  assert.match(source, /--compose-task9-bundle/);
  assert.match(source, /--reviewed-helper-sha256/);
  assert.match(source, /policy_snapshot="\$transaction_dir\/policy-compose\.json"/);
  assert.match(
    source,
    /prepare_gh; \[ "\$\(sha256 "\$transaction_dir\/tools\/gh\/bin\/gh"\)" = "\$\(json_get "\$policy" supplyChainProvenance\.ownerCli\.binarySha256\)" \]/
  );
  assert.match(source, /\[ "\$\(sha256 "\$helper"\)" = "\$reviewed_helper_sha" \]/);
  assert.match(source, /helper_copy="\$transaction_dir\/task9-compose-bundle\.sh"/);
  assert.match(source, /\/bin\/cp -p -- "\$helper" "\$helper_copy"/);
  assert.match(source, /\[ "\$\(sha256 "\$helper_copy"\)" = "\$reviewed_helper_sha" \]/);
  assert.match(source, /exec "\$helper_copy" --transaction-dir/);
});

test('uses a rollback-armed, post-activation immutable Task 7 probe contract', () => {
  assert.match(source, /for probe_id in 0 1 2/);
  for (const operation of ['create-owned-probe-tag-object', 'create-owned-probe-ref', 'read-owned-probe-ref', 'rollback-owned-probe-ref', 'assert-owned-probe-duplicate-create', 'assert-owned-probe-update', 'assert-owned-probe-force-update', 'assert-owned-probe-delete'])
    assert.match(source, new RegExp(operation));
  assert.match(source, /task7-probe-\$probe_id\.json/);
  assert.match(source, /task7_cleanup/);
  assert.match(source, /task7-manual-reconciliation\.json/);
  assert.match(source, /task7_activated=1 task7_armed=0/);
  assert.doesNotMatch(source, /\/bin\/sh -c/);
});

test('binds the exact Task 9 root controller exchange and release acknowledgement', () => {
  assert.match(source, /readonly VPS_SSH="\$SCRIPT_DIR\/vps-ssh\.sh"/);
  for (const mode of ['begin', 'rearm', 'admit', 'release', 'abort']) assert.match(source, new RegExp(`exact-run-controller\\.sh --${mode} \\$campaign_id`));
  for (const mode of ['begin', 'rearm', 'admission', 'inventory']) assert.match(source, new RegExp(`task9-owner-documents\\.mjs[\\s\\S]*--${mode}`));
  assert.match(source, /root-admission-challenge\$suffix\.json[\s\S]*root-hold\$suffix\.json[\s\S]*root-inventory\$suffix\.json/);
  assert.match(source, /for second in 0 1 2 3 4 5[\s\S]*acknowledgement/);
  assert.match(source, /trap 'task9_cancel; task9_manual; task9_abort' EXIT HUP INT TERM/);
  assert.match(
    source,
    /task9_root_started=1; task9_root begin[\s\S]*task9_doc admission/
  );
  assert.doesNotMatch(
    source,
    /task9_root begin[^\n]*; task9_root_started=1/
  );
});

test('permits exactly one root-authorized same-run attempt-two rearm', () => {
  const terminal = source.match(/task9_terminal\(\) \{[\s\S]*?\n\}\n# shellcheck disable=SC2016/)?.[0];
  assert.ok(terminal);
  assert.match(terminal, /\(FAILED\).*run\.attempt.*= 1.*read-failed-job-evidence.*rerun-failed-exact-run/s);
  assert.match(terminal, /rerun-failed-exact-run[\s\S]*task9_until_attempt_two "\$failed_run_id"[\s\S]*task9_until list-attestation-runs/);
  assert.match(source, /task9_until_attempt_two\(\).*while.*RERUN_REQUESTED.*count.*-lt 120.*task9_cancel.*task9_manual.*task9 read-exact-run/s);
  assert.match(source, /task9_doc rearm.*task9_root rearm/s);
  assert.match(source, /root-rearm-authorization\.json[\s\S]*binding_sha=.*createHash\("sha256"\)[\s\S]*bindingSha256/);
  assert.match(source, /root-binding\$suffix\.json[\s\S]*root-admission-challenge\$suffix\.json/);
  assert.match(source, /\[ "\$attempt" = 2 \][\s\S]*\[ "\$rerun_pending" = 0 \]/);
  assert.doesNotMatch(source, /attempt.?3|expectedAttempt.?3/);
});

test('polls queued and running states until the exact transport deadline terminates', () => {
  const terminal = source.match(/task9_terminal\(\) \{[\s\S]*?\n\}\n# shellcheck disable=SC2016/)?.[0];
  assert.ok(terminal);
  assert.match(terminal, /task9_terminal\(\) \{ while :; do task9 read-exact-run/);
  assert.match(terminal, /\(QUEUED\|RUNNING\) \/bin\/sleep 1;;/);
  assert.doesNotMatch(terminal, /for second|\$second|manual reconciliation/);
});

test('spaces post-dispatch reconciliation until its monotonic propagation deadline', () => {
  const reconcile = source.match(/task9_until\(\) \{[^\n]+\}/)?.[0];
  assert.ok(reconcile);
  const script = [
    reconcile,
    `node=${process.execPath}`,
    'calls=0',
    'task9() { calls=$((calls + 1)); }',
    `json_get() { case "$2" in (phase) [ "$calls" -lt 2 ] && printf '%s' DISPATCH_ACCEPTED || printf '%s' QUEUED;; (queueDeadlineMonotonicMs) "$node" -e 'process.stdout.write(String(Number(process.hrtime.bigint()/1000000n)+5000))';; (postDispatchEvidence.run.id|run.id) printf '%s' 1;; (postDispatchEvidence.run.attempt|run.attempt) printf '%s' 1;; (*) exit 64;; esac; }`,
    `started=$($node -e 'process.stdout.write(String(Number(process.hrtime.bigint()/1000000n)))')`,
    'task9_until list-attestation-runs',
    `finished=$($node -e 'process.stdout.write(String(Number(process.hrtime.bigint()/1000000n)))')`,
    `printf 'calls=%s elapsed=%s\\n' "$calls" "$((finished - started))"`,
  ].join('\n');
  const result = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /calls=2 elapsed=[1-9][0-9]{2,}/);
  assert.match(reconcile, /queueDeadlineMonotonicMs[\s\S]*dispatchIntent\.reconcileDeadlineMonotonicMs[\s\S]*\/bin\/sleep 1/);
});

test('continues a persisted indeterminate dispatch through bounded run-list reconciliation', () => {
  const exact = source.match(/task9_exact\(\) \{[\s\S]*?\n\}/)?.[0];
  const reconcile = source.match(/task9_until\(\) \{[^\n]+\}/)?.[0];
  assert.ok(exact && reconcile);
  const script = [
    'set -eu', `node=${process.execPath}`, 'state=state state_sha=state.sha source_authorization=source source_authorization_sha256=source.sha',
    'phase=QUIESCENT lists=0 dispatches=0 campaigns=0',
    'json_get() { case "$2" in (sourceAuthorization.transactionId) printf transaction;; (phase) printf "%s" "$phase";; (postDispatchEvidence.run.id|run.id|postDispatchEvidence.run.attempt|run.attempt) printf 1;; (*) exit 64;; esac; }',
    'task9() { case $1 in (list-attestation-runs) lists=$((lists + 1)); [ "$lists" = 1 ] && phase=QUIESCENT || phase=QUEUED;; (dispatch-exact-run) dispatches=$((dispatches + 1)); phase=DISPATCH_INDETERMINATE; return 1;; (*) exit 64;; esac; }',
    'task9_campaign() { campaigns=$((campaigns + 1)); }; task9_cancel() { :; }; task9_manual() { :; }; task9_abort() { :; }', reconcile, exact, 'task9_exact', 'printf "lists=%s dispatches=%s campaigns=%s phase=%s\\n" "$lists" "$dispatches" "$campaigns" "$phase"',
  ].join('\n');
  const result = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lists=2 dispatches=1 campaigns=1 phase=QUEUED/);
});

test('rehashes the canonical Task 9 source closure and reconciles every terminal branch', () => {
  const sources = TASK9_SOURCE_FILES.join(' ');
  assert.match(source, new RegExp(`readonly TASK9_SOURCES='${sources}'`));
  assert.match(source, /sourceFiles\.\$index\.path[\s\S]*sourceFiles\.\$index\.sha256[\s\S]*sha256 "\$source_file"/);
  assert.match(source, /task9_manifest_sha=''.*source_path.*task9-source-authorization\.mjs.*task9_manifest_sha=\$expected/s);
  assert.match(source, /--eval 'import \{createHash\} from "node:crypto";import \{fstatSync,lstatSync,readFileSync\} from "node:fs";.*same\(held,current\).*readFileSync\(3\).*data:text\/javascript;base64.*runTask9SourceAuthorizationCli/s);
  assert.match(source, /"\$manifest_sha".*3<"\$manifest"/s);
  assert.doesNotMatch(source, /"\$node" "\$manifest" (?:verify|execute)/);
  assert.match(source, /\[ "\$vps" = "\$VPS_SSH" \][\s\S]*file_mode "\$vps"\)" = 755/);
  assert.match(source, /task9-owner-documents\.mjs"; assert_child_file "\$documents"; \[ "\$\(file_mode "\$documents"\)" = 644 \]/);
  assert.match(source, /task9_root_started=0; task9_cleanup_confirmed=0; rerun_pending=0; trap 'task9_cancel; task9_manual; task9_abort' EXIT HUP INT TERM; task9_until list-attestation-runs[\s\S]*if task9 dispatch-exact-run[\s\S]*phase=\$\(json_get "\$state" phase\)[\s\S]*\[ "\$phase" = DISPATCH_INDETERMINATE \][\s\S]*task9_until list-attestation-runs/);
  assert.match(source, /task9_until\(\).*postDispatchEvidence\.run\.id.*DISPATCH_ACCEPTED\|DISPATCH_INDETERMINATE.*queueDeadlineMonotonicMs.*dispatchIntent\.reconcileDeadlineMonotonicMs.*runnerEvidence\.runnerId/);
  assert.match(source, /"phase":"MANUAL_RECONCILIATION"/);
});

test('continues from release through verified evidence and terminal reconciliation', () => {
  for (const operation of ['read-exact-run', 'read-exact-job', 'list-exact-artifacts', 'download-exact-artifact'])
    assert.match(source, new RegExp(`task9_until ${operation}|task9 ${operation}`));
  assert.match(source, /s\.phase!=="EVIDENCE_VERIFIED"/);
  assert.match(source, /artifactReadbackEvidence\.ownerHandoffSha256!==h\(c\(s\.ownerEvidenceHandoff\)\)/);
  assert.match(source, /owner-evidence-handoff\.json.*artifact-readback-evidence\.json.*h0-runner-attestation\.json/);
  assert.match(source, /sha256 "\$transaction_dir\/h0-runner-attestation\.json".*ownerEvidenceHandoff\.memberSha256/);
  assert.match(source, /task9_completion_trigger; task9_root complete "\$transaction_dir\/root-completion-trigger\.json" "\$transaction_dir\/root-terminal\.json"/);
  assert.match(source, /task9_success_handoff; task9_root_started=0/);
  assert.match(source, /\/private\/tmp\/baci-cwv-h0-evidence-\$\(json_get "\$state" sourceAuthorization\.transactionId\)/);
  assert.match(source, /publishTask9SuccessHandoff/);
  assert.match(source, /task9-cleanup-complete\.json/);
  assert.match(source, /root-\$label-trigger\$suffix\.json/);
  assert.match(source, /\(CANCELED\).*task9_abort/);
  assert.match(source, /task9_cancel\(\).*\(DISPATCH_ACCEPTED\|QUEUED\|RUNNING\|RERUN_INTENT\|RERUN_REQUESTED\).*task9 cancel-exact-run/);
  assert.match(source, /task9_cancel\(\).*[;(]task9 cancel-exact-run[^\n]*\)[^\n]*\|\| \{ task9_manual bounded-cleanup-unconfirmed; return; \}/);
  assert.match(source, /CANCEL_ACCEPTED[\s\S]*task9 read-exact-run[\s\S]*CANCELED[\s\S]*task9_cleanup_confirmed=1/);
  assert.match(source, /CANCEL_INTENT[\s\S]*task9_manual cancel-response-loss/);
  assert.match(source, /task9-manual-reconciliation\.json[\s\S]*cleanupDeadlineMonotonicMs[\s\S]*stateGeneration/);
  assert.match(source, /trap 'task9_cancel; task9_manual; task9_abort' EXIT HUP INT TERM/);
  assert.match(source, /put\("root-channel".*put\("root-terminal-runtime".*put\("root-restore"/);
  assert.match(source, /put\("root-runner-hold-channel".*put\("root-runner-hold"/);
});

test('uses the live transaction-local cleanup tool once and leaves durable completion validation inside it', () => {
  const handoff = source.match(/task9_success_handoff\(\) \{[^\n]+/)?.[0];
  assert.ok(handoff);
  assert.match(handoff, /state_cleanup="\$SCRIPT_DIR\/owner-api-transport-cli-state\.mjs"/);
  assert.match(handoff, /TASK9_EVIDENCE_DIRECTORY-\$\{evidence_directory-/);
  assert.doesNotMatch(handoff, /json_get "\$state" sourceAuthorization/);
  assert.doesNotMatch(handoff, /state_cleanup="\$transaction_dir\/authorized-source/);
  assert.match(handoff, /task9-cleanup-pending\.json/);
  assert.match(handoff, /task9-cleanup-pending\.json[\s\S]*\[ ! -e "\$evidence_directory\/task9-cleanup-complete\.json" \]/);
  const afterCleanup = handoff.split("publishTask9SuccessHandoff({evidenceDirectory,statePath,stateShaPath});' \"$state_cleanup\" \"$evidence_directory\" \"$state\" \"$state_sha\" || refuse;")[1]; assert.equal(afterCleanup, ' }'); assert.doesNotMatch(afterCleanup, /\$node|state_cleanup|\$transaction_dir/);
});

test('publishes every Task 9 and Task 7 receipt with atomic hard-link no-clobber', () => {
  assert.match(source, /durable_sync\(\).*fs\.openSync\(value,fs\.constants\.O_RDONLY\|fs\.constants\.O_NOFOLLOW\|directory\)[\s\S]*fs\.fsyncSync\(descriptor\)[\s\S]*else \/bin\/sync/);
  assert.match(source, /\[ "\$node" = "\$transaction_dir\/tools\/node\/bin\/node" \]/);
  assert.match(source, /publish_once\(\).*durable_sync "\$temporary"[\s\S]*\/bin\/ln "\$temporary" "\$output"[\s\S]*durable_sync "\$output"[\s\S]*\/bin\/rm -f -- "\$temporary"/);
  assert.doesNotMatch(source, /\/bin\/sync -f/);
  assert.doesNotMatch(source, />"\$transaction_dir\/(?:root-abort-trigger|root-completion-trigger)\.json"/);
  assert.doesNotMatch(source, /\/bin\/mv -n/);
});

test('follows at most one explicit GitHub asset redirect', () => {
  assert.doesNotMatch(source, /--location|--proto-redir/);
  assert.match(source, /--max-redirs 0[\s\S]*%\{http_code\}\\n%\{redirect_url\}/);
  assert.match(source, /301:https:\/\/release-assets\.githubusercontent\.com\/\*[\s\S]*\[ "\$origin_class" = gh \]/);
});

test('does not let a failed verifier be masked by a successful token consumer', () => {
  assert.equal(spawnSync('/bin/sh', ['-c', 'false | { true; }']).status, 0);
  assert.match(source, /verifier_code=\$\?[\s\S]*\[ "\$verifier_code" = 0 \]/);
});

test('terminates and reaps a TERM-resistant post-ack release child when already expired', () => {
  const helper = source.match(/wait_bounded_release\(\) \{[^\n]+\}/)?.[0];
  assert.ok(helper);
  const result = spawnSync(
    '/bin/sh',
    [
      '-c',
      `${helper}\n/bin/sh -c 'trap "" TERM; exec /bin/sleep 30' & child=$!\nset +e\nwait_bounded_release "$child" 0\nstatus=$?\n/bin/kill -0 "$child" 2>/dev/null\nalive=$?\nprintf 'status=%s alive=%s\\n' "$status" "$alive"`,
    ],
    { encoding: 'utf8', timeout: 3000 }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=124 alive=[1-9][0-9]*/);
  assert.match(result.stderr, /owner release timeout/);
});

test('bounds a TERM-resistant post-ack release child after a positive budget', () => {
  const helper = source.match(/wait_bounded_release\(\) \{[^\n]+\}/)?.[0];
  assert.ok(helper);
  const startedAt = Date.now();
  const result = spawnSync(
    '/bin/sh',
    [
      '-c',
      `${helper}\n/bin/sh -c 'trap "" TERM; exec /bin/sleep 30' & child=$!\nset +e\nwait_bounded_release "$child" 75 "${process.execPath}"\nstatus=$?\n/bin/kill -0 "$child" 2>/dev/null\nalive=$?\nprintf 'status=%s alive=%s\\n' "$status" "$alive"`,
    ],
    { encoding: 'utf8', timeout: 3000 }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.ok(Date.now() - startedAt < 1500);
  assert.match(result.stdout, /status=124 alive=[1-9][0-9]*/);
  assert.match(result.stderr, /owner release timeout/);
  assert.match(source, /process\.kill\(process\.ppid,"SIGALRM"\)/);
  assert.match(source, /\/bin\/kill -TERM "\$release_wait_pid"/);
  assert.match(source, /\/bin\/kill -KILL "\$release_wait_pid"/);
  assert.match(source, /wait "\$release_wait_pid"/);
  const rootExchange = source.match(/task9_root\(\) \([\s\S]*?\n\)/)?.[0];
  assert.ok(rootExchange);
  assert.match(rootExchange, /deadlineMonotonicMs/);
  assert.match(rootExchange, /process\.hrtime\.bigint/);
  assert.match(rootExchange, /wait_bounded_release "\$release_pid"/);
});
