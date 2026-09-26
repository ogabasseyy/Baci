# App Store Connect keeps at most ONE editable version, and the release
# workflow mints a fresh marketing version per run (2.1.<build>). While a
# previous version still holds that slot in a non-editable state (in review,
# pending developer release), `set_changelog` finds no version to rename and
# POSTs a new one, which Apple refuses with "You cannot create a new version
# of the App in the current state" — the whole submit step then dies AFTER the
# binary already uploaded. `deliver`'s own `reject_if_possible` would clear the
# way, but it runs inside `deliver`, long after `set_changelog` has failed.
#
# Resolve the slot up front instead. Cancelling withdraws a build Apple may be
# actively reviewing, so it is opt-in: without it we skip submission and leave
# the (already uploaded) build on TestFlight to submit by hand.

EDITABLE_VERSION_POLL_ATTEMPTS = 40
EDITABLE_VERSION_POLL_INTERVAL_SECONDS = 15

# Build.all defaults to "PROCESSING,FAILED,INVALID,VALID". Only VALID builds can
# actually be attached to a submission, so anything else must not be treated as
# a usable replacement for a review we are about to withdraw.
SUBMITTABLE_BUILD_PROCESSING_STATE = "VALID"

def review_cancellation_allowed?
  %w[1 true yes].include?(ENV["IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT"].to_s.strip.downcase)
end

# Withdrawing a live review before knowing a usable replacement exists would
# leave the app with NOTHING under review, so this must run before
# `cancel_submission`. The lookup mirrors deliver's `select_build` (same
# Spaceship::ConnectAPI::Build filters, same "latest" fallback) but is
# deliberately stricter in two ways, because deliver only discovers these after
# the review is already gone:
#   * only VALID builds count — PROCESSING/FAILED/INVALID cannot be submitted;
#   * expired builds are rejected;
#   * the requested marketing version always scopes the query, including the
#     "latest" fallback, so `deliver_opts[:app_version]` cannot end up pointing
#     at a version that has no build behind it.
def ensure_replacement_build_exists!(app, platform, app_version:, build_number:)
  requested_build = build_number.to_s.strip
  requested_version = app_version.to_s.strip
  specific_build = !requested_build.empty? && requested_build != "latest"

  build = Spaceship::ConnectAPI::Build.all(
    app_id: app.id,
    version: requested_version.empty? ? nil : requested_version,
    build_number: specific_build ? requested_build : nil,
    platform: platform,
    processing_states: SUBMITTABLE_BUILD_PROCESSING_STATE
  ).reject(&:expired).first

  return build if build

  UI.user_error!(
    "Refusing to withdraw the in-progress App Review submission: no unexpired, " \
    "processed (#{SUBMITTABLE_BUILD_PROCESSING_STATE}) TestFlight build matches version " \
    "#{requested_version.empty? ? '(latest)' : requested_version} build " \
    "#{specific_build ? requested_build : '(latest)'}. " \
    "Correct SUBMIT_APP_VERSION / SUBMIT_BUILD_NUMBER and retry."
  )
end

# `get_in_progress_review_submission` only matches WAITING_FOR_REVIEW, IN_REVIEW
# and UNRESOLVED_ISSUES, so a cancelled submission drops out of that query the
# moment Apple flips it to CANCELING — which happens BEFORE the version becomes
# editable again. Polling for the submission to disappear would therefore return
# too early. Poll for the editable version itself, which is the state
# `set_changelog` actually needs.
# Diagnostic only: names the version state holding the single editable slot so
# the skip message is actionable. Never raises — a failed lookup must not turn a
# successful upload into a failed build.
def blocking_app_store_version_state(app, platform)
  version = app.get_latest_app_store_version(platform: platform)
  return "unknown" unless version

  "#{version.version_string} #{version.app_version_state}"
rescue StandardError => e
  "unavailable (#{e.class})"
end

def wait_for_editable_app_store_version(app, platform)
  EDITABLE_VERSION_POLL_ATTEMPTS.times do |attempt|
    version = app.get_edit_app_store_version(platform: platform)
    return version if version

    sleep(EDITABLE_VERSION_POLL_INTERVAL_SECONDS) unless attempt == EDITABLE_VERSION_POLL_ATTEMPTS - 1
  end

  nil
end

# Returns true when an editable version is available (so set_changelog can
# rename it into the version we are shipping) and false when submission must be
# skipped this run. Skipping is deliberate: the IPA is already on TestFlight, so
# an App Store Connect metadata state must not red-fail an otherwise good build.
def app_store_version_slot_ready?(app_version:, build_number:)
  app = Spaceship::ConnectAPI::App.find(BUNDLE_ID)
  UI.user_error!("Could not find App Store Connect app #{BUNDLE_ID}") unless app

  platform = Spaceship::ConnectAPI::Platform::IOS

  # Consult the live review BEFORE trusting the editable shortcut: an editable
  # version can briefly coexist with an in-progress review (the state in which
  # deliver's reject_if_possible withdrew build 2.1.527). Checking the review
  # first keeps every withdrawal behind the opt-in below.
  submission = app.get_in_progress_review_submission(platform: platform)
  if submission.nil?
    return true if app.get_edit_app_store_version(platform: platform)

    # Nothing is in review, yet the slot is still occupied — e.g. a version in
    # PENDING_DEVELOPER_RELEASE or PENDING_APPLE_RELEASE. There is no safe
    # automatic remedy (clearing those means releasing an already-approved
    # build to the public, which is a far bigger decision than withdrawing a
    # review), so report the blocking state and let a human decide.
    UI.important(
      "No editable App Store version is available and no submission is in review " \
      "(blocking version state: #{blocking_app_store_version_state(app, platform)}). " \
      "Skipping submission — the build is uploaded and can be submitted from App " \
      "Store Connect once that version is released or cleared."
    )
    return false
  end

  unless review_cancellation_allowed?
    UI.important(
      "A previous submission is still with App Review, so the single editable-version " \
      "slot is taken; skipping submission. The build is uploaded and can be submitted " \
      "from App Store Connect. Set IOS_STOREFRONT_CANCEL_REVIEW_FOR_RESUBMIT=1 to " \
      "withdraw that submission and replace it instead."
    )
    return false
  end

  ensure_replacement_build_exists!(
    app,
    platform,
    app_version: app_version,
    build_number: build_number
  )

  submission.cancel_submission
  UI.message("Requested cancellation of the in-progress App Store review submission")

  return true if wait_for_editable_app_store_version(app, platform)

  # Skipping is only safe while nothing has been destroyed. The previous
  # submission is now withdrawn, so exiting green here would report success with
  # NOTHING under review. Fail loudly instead.
  UI.user_error!(
    "Cancelled the previous App Review submission but no editable App Store version " \
    "appeared within #{EDITABLE_VERSION_POLL_ATTEMPTS * EDITABLE_VERSION_POLL_INTERVAL_SECONDS} " \
    "seconds. The previous submission has been withdrawn and this build was NOT submitted — " \
    "finish the submission from App Store Connect."
  )
end
