# Decides whether the submit lane may touch App Store Connect while an earlier
# version still holds the single editable slot. It never withdraws a review:
# with several merges a day, withdrawing and resubmitting keeps pushing the app
# to the back of Apple's queue.

# Approved versions that are not public yet. Apple will not accept a successor.
APPROVED_UNRELEASED_VERSION_STATES = %w[
  ACCEPTED
  PENDING_DEVELOPER_RELEASE
  PENDING_APPLE_RELEASE
  PROCESSING_FOR_DISTRIBUTION
].freeze

# Submissions on their way out, which the in-progress query does not return.
UNSETTLED_SUBMISSION_STATES = %w[CANCELING COMPLETING].freeze

# `announce: false` is for the scheduled check: a held slot is its normal state,
# so a warning on every run would only be noise.
def pending_review_blocks_submission?(app_id:, announce: true)
  app = Spaceship::ConnectAPI::App.find(app_id)
  UI.user_error!("Could not find App Store Connect app #{app_id}") unless app

  platform = Spaceship::ConnectAPI::Platform::IOS
  submission = app.get_in_progress_review_submission(platform: platform)

  # A rejection needs a person, so the run must not look successful.
  if submission&.state == "UNRESOLVED_ISSUES"
    UI.user_error!(
      "Apple rejected the last submission. Read the message under App Review in " \
      "App Store Connect, fix it, then resubmit or remove that submission. " \
      "This build is on TestFlight."
    )
  end

  holding_state = submission&.state || occupied_slot_state(app, platform)
  return false unless holding_state

  if announce
    message =
      "An earlier version still holds the App Store slot (#{holding_state}), so " \
      "this build was not submitted. It is on TestFlight."
    UI.important(message)
    puts "::warning title=Not submitted to App Review::#{message}"
  else
    UI.message("An earlier version still holds the App Store slot (#{holding_state}). Nothing to do.")
  end
  true
end

# States the in-progress query does not return. Anything unrecognised falls
# through, so the lane tries and fails loudly rather than skipping in silence.
def occupied_slot_state(app, platform)
  # Matched here, not in the query: Apple can refuse a state filter value.
  unsettled = app.get_review_submissions(filter: { platform: platform })
                 .map(&:state)
                 .find { |state| UNSETTLED_SUBMISSION_STATES.include?(state) }
  return unsettled if unsettled

  # Every version is read, not only the editable or latest one, so an approved
  # version is found even when a successor already exists beside it.
  app.get_app_store_versions(filter: { platform: platform })
     .map(&:app_version_state)
     .find { |state| APPROVED_UNRELEASED_VERSION_STATES.include?(state) }
end
