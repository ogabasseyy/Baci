import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VALID_SLOT = `def review_cancellation_allowed?
  %w[1 true yes].include?(ENV["IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT"].to_s.strip.downcase)
end

def ensure_replacement_build_exists!(app, platform, app_version:, build_number:)
  build = Spaceship::ConnectAPI::Build.all(
    app_id: app.id,
    version: requested_version,
    build_number: requested_build,
    platform: platform,
    processing_states: SUBMITTABLE_BUILD_PROCESSING_STATE
  ).reject(&:expired).first

  return build if build

  UI.user_error!("no replacement build")
end

def wait_for_editable_app_store_version(app, platform)
  EDITABLE_VERSION_POLL_ATTEMPTS.times do
    version = app.get_edit_app_store_version(platform: platform)
    return version if version

    sleep(EDITABLE_VERSION_POLL_INTERVAL_SECONDS)
  end

  nil
end

UNSETTLED_REVIEW_SUBMISSION_STATES = %w[
  WAITING_FOR_REVIEW
  IN_REVIEW
  UNRESOLVED_ISSUES
  CANCELING
  COMPLETING
].freeze

def wait_for_settled_review_submission(submission_id)
  begin
    state = Spaceship::ConnectAPI::ReviewSubmission.get(
      review_submission_id: submission_id
    )&.state
  rescue *RETRYABLE_REVIEW_POLL_ERRORS
    state = nil
  end
  return !state.nil? && !UNSETTLED_REVIEW_SUBMISSION_STATES.include?(state)
end

def app_store_version_slot_ready?(app_version:, build_number:)
  app = Spaceship::ConnectAPI::App.find(BUNDLE_ID)
  platform = Spaceship::ConnectAPI::Platform::IOS
  submission = app.get_in_progress_review_submission(platform: platform)
  if submission.nil?
    return true if app.get_edit_app_store_version(platform: platform)
    return false
  end

  unless review_cancellation_allowed?
    return false
  end

  ensure_replacement_build_exists!(
    app,
    platform,
    app_version: app_version,
    build_number: build_number
  )

  submission.cancel_submission

  unless wait_for_settled_review_submission(submission.id)
    UI.user_error!("cancelled but the review never settled")
  end

  return true if wait_for_editable_app_store_version(app, platform)

  UI.user_error!("cancelled but no editable version appeared")
end`;

const VALID_FASTFILE = `import("asc_version_slot.rb")

lane :submit do
  api_key = asc_api_key
  deliver_opts = {
    submit_for_review: true
  }

  unless app_store_version_slot_ready?(app_version: app_version, build_number: build_number)
    next
  end

  set_changelog(changelog_opts)
  update_app_review_notes!(review_notes_text, app_version: app_version)
  deliver(deliver_opts)
end`;

const readFastlaneFile = (name: string) =>
  readFileSync(join(__dirname, '..', 'fastlane', name), 'utf8');

export const submitVersionGuardFixtures = {
  VALID_FASTFILE,
  VALID_SLOT,
  readFastlaneFile,
};
