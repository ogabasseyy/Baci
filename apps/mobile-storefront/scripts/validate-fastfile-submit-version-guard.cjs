const {
  stripRubyComments,
  extractIndentedBlock,
} = require('./validate-fastfile-slot-parse.cjs');
const assertCancelGuard = require('./validate-fastfile-cancel-guard.cjs');

/**
 * App Store Connect keeps one editable version. When a prior version still
 * holds that slot, `set_changelog` tries to CREATE the newly minted version and
 * Apple refuses ("You cannot create a new version of the App in the current
 * state"), killing the submit step after the binary already uploaded. The lane
 * must therefore resolve the slot BEFORE calling set_changelog, and must only
 * withdraw a build from active review behind an explicit opt-in — after
 * confirming the replacement build exists, and waiting for the version to
 * actually become editable again.
 */
function validateFastfileSubmitVersionGuard(fastfileSource, versionSlotSource) {
  const failures = [];
  const activeFastfile = stripRubyComments(fastfileSource);
  const activeSlot = stripRubyComments(versionSlotSource ?? '');

  if (!/import\(["']asc_version_slot\.rb["']\)/.test(activeFastfile)) {
    failures.push(
      'Fastfile: must import asc_version_slot.rb, otherwise the version-slot helpers are undefined'
    );
  }

  if (!/def\s+app_store_version_slot_ready\?/.test(activeSlot)) {
    failures.push(
      'asc_version_slot.rb: missing app_store_version_slot_ready? — submit would crash when the editable version slot is occupied'
    );
  }

  const submitLane = extractIndentedBlock(
    activeFastfile,
    /^\s*lane\s+:submit\s+do\s*$/,
    'end'
  );
  if (!submitLane) return [...failures, 'Fastfile: missing submit lane'];

  const guardIndex = submitLane.indexOf('app_store_version_slot_ready?');
  const changelogIndex = submitLane.indexOf('set_changelog(');

  if (guardIndex === -1) {
    failures.push(
      'Fastfile: submit lane must call app_store_version_slot_ready? before set_changelog'
    );
  } else if (changelogIndex !== -1 && guardIndex > changelogIndex) {
    failures.push(
      'Fastfile: app_store_version_slot_ready? must run BEFORE set_changelog, not after'
    );
  }

  if (changelogIndex === -1) {
    failures.push('Fastfile: submit lane is missing set_changelog');
  }

  // deliver's own reject_if_possible is a SECOND, unguarded cancellation path:
  // it withdraws whatever is in App Review regardless of the
  // IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT opt-in that
  // app_store_version_slot_ready? enforces. It silently cancelled build 2.1.527's
  // review when 2.1.528 shipped. Cancellation must be owned solely by the guard.
  if (submitLane.includes('reject_if_possible')) {
    failures.push(
      'Fastfile: submit lane must not pass reject_if_possible — cancellation is owned solely by app_store_version_slot_ready? (opt-in via IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT); deliver reject_if_possible is an unguarded second path that withdraws live App Reviews'
    );
  }

  const cancellationGate =
    /def\s+review_cancellation_allowed\?[\s\S]*?IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT/;
  if (!cancellationGate.test(activeSlot)) {
    failures.push(
      'asc_version_slot.rb: withdrawing a build from App Review must stay gated behind IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT'
    );
  }

  // An editable version can briefly coexist with a live review (this is the
  // state in which deliver's reject_if_possible withdrew build 2.1.527), so
  // the guard must consult the in-progress review before trusting the
  // editable shortcut — otherwise the opt-in below is skipped.
  const slotGuard = extractIndentedBlock(
    activeSlot,
    /^\s*def\s+app_store_version_slot_ready\?/,
    'end'
  );
  if (slotGuard) {
    const submissionIndex = slotGuard.indexOf(
      'get_in_progress_review_submission'
    );
    const editableIndex = slotGuard.indexOf('get_edit_app_store_version');
    if (
      submissionIndex === -1 ||
      editableIndex === -1 ||
      submissionIndex > editableIndex
    ) {
      failures.push(
        'asc_version_slot.rb: app_store_version_slot_ready? must query get_in_progress_review_submission before the get_edit_app_store_version shortcut'
      );
    }
  }

  // A cancellation from another run (or a crashed one we never waited out)
  // is invisible to the in-progress query, so the guard must rule out a
  // winding-down submission before trusting the editable shortcut.
  if (slotGuard) {
    const windingIndex = slotGuard.indexOf('winding_down_review_submission?');
    const shortcutIndex = slotGuard.indexOf('get_edit_app_store_version');
    if (
      windingIndex === -1 ||
      shortcutIndex === -1 ||
      windingIndex > shortcutIndex
    ) {
      failures.push(
        'asc_version_slot.rb: app_store_version_slot_ready? must rule out a winding-down cancellation before the get_edit_app_store_version shortcut'
      );
    }
  }

  const windingHelper = extractIndentedBlock(
    activeSlot,
    /^\s*def\s+winding_down_review_submission\?/,
    'end'
  );
  if (
    !windingHelper ||
    !windingHelper.includes('get_review_submissions') ||
    !windingHelper.includes('CANCELING')
  ) {
    failures.push(
      'asc_version_slot.rb: winding_down_review_submission? must list submissions filtered on the verified CANCELING state'
    );
  }


  assertCancelGuard(activeSlot, failures);

  return failures;
}

module.exports = { validateFastfileSubmitVersionGuard };
