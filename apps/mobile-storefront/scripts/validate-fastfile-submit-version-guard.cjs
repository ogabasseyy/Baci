function stripRubyComments(source) {
  let inBlockComment = false;
  return source
    .split('\n')
    .filter((line) => {
      if (/^=begin(?:\s|$)/.test(line)) {
        inBlockComment = true;
        return false;
      }
      if (inBlockComment) {
        if (/^=end(?:\s|$)/.test(line)) inBlockComment = false;
        return false;
      }
      return true;
    })
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n');
}

function extractIndentedBlock(source, declarationPattern, closingToken) {
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => declarationPattern.test(line));
  if (startIndex === -1) return null;

  const indentation = lines[startIndex].match(/^\s*/)?.[0] ?? '';
  const closingLine = `${indentation}${closingToken}`;
  const endOffset = lines
    .slice(startIndex + 1)
    .findIndex((line) => line.trimEnd() === closingLine);
  if (endOffset === -1) return null;

  return lines.slice(startIndex, startIndex + endOffset + 2).join('\n');
}

/** Index of a call site, ignoring the `def` line that shares the same name. */
function callSiteIndex(source, methodName) {
  const match = new RegExp(
    `^[ \\t]*(?:return\\s+\\w+\\s+if\\s+)?${methodName.replace(/[!?]/g, '\\$&')}\\(`,
    'm'
  ).exec(source);
  return match ? match.index : -1;
}

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

  const cancelIndex = activeSlot.indexOf('cancel_submission');
  if (cancelIndex !== -1) {
    // Presence of the gate is not enough — it has to sit BEFORE the
    // cancellation, otherwise a reordering edit would silently withdraw App
    // Review without the opt-in while this validator stayed green.
    const gateIndex = activeSlot.search(/unless\s+review_cancellation_allowed\?/);
    if (gateIndex === -1 || gateIndex > cancelIndex) {
      failures.push(
        'asc_version_slot.rb: cancel_submission must be guarded by review_cancellation_allowed?'
      );
    }
  }

  if (cancelIndex !== -1) {
    // Withdrawing the live review before knowing the replacement build exists
    // would leave the app with nothing under review at all.
    const validationIndex = callSiteIndex(activeSlot, 'ensure_replacement_build_exists!');
    if (validationIndex === -1 || validationIndex > cancelIndex) {
      failures.push(
        'asc_version_slot.rb: ensure_replacement_build_exists! must run BEFORE cancel_submission withdraws the live review'
      );
    }

    // `get_in_progress_review_submission` stops matching as soon as Apple flips
    // the submission to CANCELING, which happens before the version is editable
    // again — so readiness must be confirmed by polling the editable version.
    const waitIndex = callSiteIndex(activeSlot, 'wait_for_editable_app_store_version');
    if (waitIndex === -1 || waitIndex < cancelIndex) {
      failures.push(
        'asc_version_slot.rb: after cancel_submission the lane must wait via wait_for_editable_app_store_version'
      );
    }

    const waiter = extractIndentedBlock(
      activeSlot,
      /^\s*def\s+wait_for_editable_app_store_version\b/,
      'end'
    );
    if (!waiter || !waiter.includes('get_edit_app_store_version')) {
      failures.push(
        'asc_version_slot.rb: wait_for_editable_app_store_version must poll get_edit_app_store_version, not the in-progress review submission'
      );
    }

    // A build that exists but is still processing, failed, invalid or expired
    // cannot replace the review we are about to withdraw.
    const buildCheck = extractIndentedBlock(
      activeSlot,
      /^\s*def\s+ensure_replacement_build_exists!/,
      'end'
    );
    if (!buildCheck || !buildCheck.includes('processing_states:')) {
      failures.push(
        'asc_version_slot.rb: ensure_replacement_build_exists! must filter on processing_states so unusable builds cannot pass'
      );
    }
    if (!buildCheck || !/reject\(&:expired\)/.test(buildCheck)) {
      failures.push(
        'asc_version_slot.rb: ensure_replacement_build_exists! must reject expired builds'
      );
    }
    if (!buildCheck || !/^\s*version:/m.test(buildCheck)) {
      failures.push(
        'asc_version_slot.rb: ensure_replacement_build_exists! must scope the lookup to the requested app version'
      );
    }

    // Once the review is withdrawn, skipping would report success with nothing
    // under review at all — the timeout has to be a hard failure.
    const guard = extractIndentedBlock(
      activeSlot,
      /^\s*def\s+app_store_version_slot_ready\?/,
      'end'
    );
    const afterWait = guard
      ? guard.slice(guard.indexOf('wait_for_editable_app_store_version('))
      : '';
    if (!guard || !afterWait.includes('UI.user_error!')) {
      failures.push(
        'asc_version_slot.rb: a post-cancellation timeout must fail the lane, not skip — the previous submission is already withdrawn'
      );
    }
  }

  return failures;
}

module.exports = { validateFastfileSubmitVersionGuard };
