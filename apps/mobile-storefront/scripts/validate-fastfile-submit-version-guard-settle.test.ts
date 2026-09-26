import submitVersionGuardValidator from './validate-fastfile-submit-version-guard.cjs';
import { submitVersionGuardFixtures } from './validate-fastfile-submit-version-guard.fixtures';

const { validateFastfileSubmitVersionGuard } = submitVersionGuardValidator;
const { VALID_FASTFILE, VALID_SLOT } = submitVersionGuardFixtures;

describe('bugfix: cancelled review still winding down while editable exists', () => {
  it('rejects trusting the editable version without waiting out the cancelled review', () => {
    const noSettleWait = VALID_SLOT.replace(
      `  unless wait_for_settled_review_submission(submission.id)\n    UI.user_error!("cancelled but the review never settled")\n  end\n\n`,
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, noSettleWait)
    ).toContain(
      'asc_version_slot.rb: after cancel_submission the lane must wait via wait_for_settled_review_submission before trusting the editable version'
    );
  });

  it('rejects a settle wait that polls the in-progress query instead of the submission', () => {
    const pollsWrongResource = VALID_SLOT.replace(
      'Spaceship::ConnectAPI::ReviewSubmission.get(',
      'app.get_in_progress_review_submission('
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, pollsWrongResource)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must re-fetch the cancelled submission by id, not the in-progress review submission'
    );
  });

  it('rejects a settle wait that ignores the unsettled-states list', () => {
    const ignoresUnsettledList = VALID_SLOT.replace(
      ' && !UNSETTLED_REVIEW_SUBMISSION_STATES.include?(state)',
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, ignoresUnsettledList)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must consult UNSETTLED_REVIEW_SUBMISSION_STATES so every active state blocks delivery'
    );
  });

  it('rejects an unsettled list that drops CANCELING', () => {
    const dropsCanceling = VALID_SLOT.replace('  CANCELING\n', '');

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, dropsCanceling)
    ).toContain(
      'asc_version_slot.rb: UNSETTLED_REVIEW_SUBMISSION_STATES must include CANCELING and COMPLETING so the settle wait cannot pass during a live wind-down'
    );
  });

  it('rejects an unsettled list that drops COMPLETING', () => {
    const dropsCompleting = VALID_SLOT.replace('  COMPLETING\n', '');

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, dropsCompleting)
    ).toContain(
      'asc_version_slot.rb: UNSETTLED_REVIEW_SUBMISSION_STATES must include CANCELING and COMPLETING so the settle wait cannot pass during a live wind-down'
    );
  });

  it('rejects a settle wait that aborts on the first transient fetch failure', () => {
    const noRetry = VALID_SLOT.replace(
      `    rescue *RETRYABLE_REVIEW_POLL_ERRORS\n      state = nil\n`,
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, noRetry)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must retry transient fetch failures via RETRYABLE_REVIEW_POLL_ERRORS instead of aborting the lane'
    );
  });
});

describe('settle wait wall-clock and winding-down guards', () => {
  it('rejects trusting the editable version before the settle wait completes', () => {
    const editableFirst = VALID_SLOT.replace(
      `  submission.cancel_submission\n\n  unless wait_for_settled_review_submission(submission.id)\n    UI.user_error!("cancelled but the review never settled")\n  end\n\n  return true if wait_for_editable_app_store_version(app, platform)\n`,
      `  submission.cancel_submission\n\n  return true if wait_for_editable_app_store_version(app, platform)\n\n  unless wait_for_settled_review_submission(submission.id)\n    UI.user_error!("cancelled but the review never settled")\n  end\n`
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, editableFirst)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must complete before wait_for_editable_app_store_version returns'
    );
  });

  it('rejects a settle wait that fetches only once', () => {
    const oneShot = VALID_SLOT.replace(
      '  EDITABLE_VERSION_POLL_ATTEMPTS.times do\n    remaining = deadline',
      '  if EDITABLE_VERSION_POLL_ATTEMPTS.positive?\n    remaining = deadline'
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, oneShot)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must poll until the submission settles instead of fetching once'
    );
  });

  it('rejects a settle wait without a monotonic deadline', () => {
    const noDeadline = VALID_SLOT.replace(
      '  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + REVIEW_SETTLE_TIMEOUT_SECONDS\n',
      ''
    ).replace(
      '    remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)\n',
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, noDeadline)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must enforce a monotonic REVIEW_SETTLE_TIMEOUT_SECONDS deadline because one rate-limited read can sleep for an hour'
    );
  });

  it('rejects a settle wait with an unbounded fetch', () => {
    const unboundedFetch = VALID_SLOT.replace(
      '      state = Timeout.timeout(remaining) do\n',
      '      state = begin\n'
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, unboundedFetch)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must bound each fetch with Timeout.timeout(remaining) so one rate-limited read cannot outlive the deadline'
    );
  });

  it('rejects an editable shortcut that skips the winding-down check', () => {
    const skipsWindingCheck = VALID_SLOT.replace(
      `    if winding_down_review_submission?(app, platform)\n      return false\n    end\n`,
      ''
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, skipsWindingCheck)
    ).toContain(
      'asc_version_slot.rb: app_store_version_slot_ready? must rule out a winding-down cancellation before the get_edit_app_store_version shortcut'
    );
  });

  it('rejects a winding-down check that does not filter CANCELING', () => {
    const ignoresCanceling = VALID_SLOT.replace(
      '::CANCELING',
      '::COMPLETE'
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, ignoresCanceling)
    ).toContain(
      'asc_version_slot.rb: winding_down_review_submission? must list submissions filtered on the verified CANCELING state'
    );
  });

  it('rejects a retryable set missing the Faraday transport failures', () => {
    const dropsFaraday = VALID_SLOT.replace('  Faraday::ConnectionFailed,\n', '');

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, dropsFaraday)
    ).toContain(
      'asc_version_slot.rb: RETRYABLE_REVIEW_POLL_ERRORS must include the Faraday transport failures so a dropped connection retries instead of aborting the lane'
    );
  });
});
