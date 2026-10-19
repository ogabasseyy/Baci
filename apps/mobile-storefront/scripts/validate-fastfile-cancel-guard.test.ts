import assertCancelGuard from './validate-fastfile-cancel-guard.cjs';
import { submitVersionGuardFixtures } from './validate-fastfile-submit-version-guard.fixtures';

const { VALID_SLOT } = submitVersionGuardFixtures;

describe('assertCancelGuard', () => {
  it('accepts a fully guarded cancellation path', () => {
    const failures: string[] = [];
    assertCancelGuard(VALID_SLOT, failures);
    expect(failures).toEqual([]);
  });

  it('rejects cancellation without the opt-in gate first', () => {
    const failures: string[] = [];
    const ungated = VALID_SLOT.replace(
      `  unless review_cancellation_allowed?\n    return false\n  end\n\n`,
      ''
    );
    assertCancelGuard(ungated, failures);
    expect(failures).toContain(
      'asc_version_slot.rb: cancel_submission must be guarded by review_cancellation_allowed?'
    );
  });

  it('rejects cancellation without the settle wait', () => {
    const failures: string[] = [];
    const noSettleWait = VALID_SLOT.replace(
      `  unless wait_for_settled_review_submission(submission.id)\n    UI.user_error!("cancelled but the review never settled")\n  end\n\n`,
      ''
    );
    assertCancelGuard(noSettleWait, failures);
    expect(failures).toContain(
      'asc_version_slot.rb: after cancel_submission the lane must wait via wait_for_settled_review_submission before trusting the editable version'
    );
  });
});
