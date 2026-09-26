/**
 * Cancellation-path assertions for the submit-version guard: everything that
 * must hold once `cancel_submission` is reachable (opt-in order, replacement
 * verification, settle waits, and timeout behavior).
 */
const extractIndentedBlock = require('./validate-fastfile-extract-indented-block.cjs');
const callSiteIndex = require('./validate-fastfile-call-site-index.cjs');

function assertCancelGuard(activeSlot, failures) {
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

    // Cancelling drops the submission from the in-progress query while Apple
    // is still winding it down (CANCELING) — and an editable version may
    // already exist — so the lane must wait out the cancelled submission
    // itself before trusting the editable version.
    const settleIndex = callSiteIndex(
      activeSlot,
      'wait_for_settled_review_submission'
    );
    if (settleIndex === -1 || settleIndex < cancelIndex) {
      failures.push(
        'asc_version_slot.rb: after cancel_submission the lane must wait via wait_for_settled_review_submission before trusting the editable version'
      );
    }

    const settleWaiter = extractIndentedBlock(
      activeSlot,
      /^\s*def\s+wait_for_settled_review_submission\b/,
      'end'
    );
    if (!settleWaiter || !settleWaiter.includes('ReviewSubmission.get')) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must re-fetch the cancelled submission by id, not the in-progress review submission'
      );
    }

    if (
      !settleWaiter ||
      !settleWaiter.includes('UNSETTLED_REVIEW_SUBMISSION_STATES')
    ) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must consult UNSETTLED_REVIEW_SUBMISSION_STATES so every active state blocks delivery'
      );
    }

    const unsettledStates = extractIndentedBlock(
      activeSlot,
      /^\s*UNSETTLED_REVIEW_SUBMISSION_STATES\s*=/,
      '].freeze'
    );
    if (
      !unsettledStates ||
      !unsettledStates.includes('CANCELING') ||
      !unsettledStates.includes('COMPLETING')
    ) {
      failures.push(
        'asc_version_slot.rb: UNSETTLED_REVIEW_SUBMISSION_STATES must include CANCELING and COMPLETING so the settle wait cannot pass during a live wind-down'
      );
    }

    if (
      !settleWaiter ||
      !settleWaiter.includes('RETRYABLE_REVIEW_POLL_ERRORS')
    ) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must retry transient fetch failures via RETRYABLE_REVIEW_POLL_ERRORS instead of aborting the lane'
      );
    }

    // The settle wait is pointless if the editable shortcut can return first:
    // an already-present editable version would let the lane deliver into the
    // wind-down the settle wait exists to prevent.
    if (settleIndex === -1 || waitIndex === -1 || settleIndex > waitIndex) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must complete before wait_for_editable_app_store_version returns'
      );
    }

    if (
      !settleWaiter ||
      !/(\.times\s+do|loop\s+do|\bwhile\b)/.test(settleWaiter)
    ) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must poll until the submission settles instead of fetching once'
      );
    }

    if (
      !settleWaiter ||
      !settleWaiter.includes('CLOCK_MONOTONIC') ||
      !settleWaiter.includes('REVIEW_SETTLE_TIMEOUT_SECONDS')
    ) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must enforce a monotonic REVIEW_SETTLE_TIMEOUT_SECONDS deadline because one rate-limited read can sleep for an hour'
      );
    }

    if (!settleWaiter || !settleWaiter.includes('Timeout.timeout(')) {
      failures.push(
        'asc_version_slot.rb: wait_for_settled_review_submission must bound each fetch with Timeout.timeout(remaining) so one rate-limited read cannot outlive the deadline'
      );
    }

    const retryableErrors = extractIndentedBlock(
      activeSlot,
      /^\s*RETRYABLE_REVIEW_POLL_ERRORS\s*=/,
      '].freeze'
    );
    if (
      !retryableErrors ||
      !retryableErrors.includes('Faraday::ConnectionFailed') ||
      !retryableErrors.includes('Faraday::TimeoutError')
    ) {
      failures.push(
        'asc_version_slot.rb: RETRYABLE_REVIEW_POLL_ERRORS must include the Faraday transport failures so a dropped connection retries instead of aborting the lane'
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
}

module.exports = assertCancelGuard;
