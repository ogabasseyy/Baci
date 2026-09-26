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
      `  begin\n    state = Spaceship::ConnectAPI::ReviewSubmission.get(\n      review_submission_id: submission_id\n    )&.state\n  rescue *RETRYABLE_REVIEW_POLL_ERRORS\n    state = nil\n  end\n`,
      `  state = Spaceship::ConnectAPI::ReviewSubmission.get(\n    review_submission_id: submission_id\n  )&.state\n`
    );

    expect(
      validateFastfileSubmitVersionGuard(VALID_FASTFILE, noRetry)
    ).toContain(
      'asc_version_slot.rb: wait_for_settled_review_submission must retry transient fetch failures via RETRYABLE_REVIEW_POLL_ERRORS instead of aborting the lane'
    );
  });
});
