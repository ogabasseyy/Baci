# Decides whether the submit lane may touch App Store Connect while an earlier
# submission is still open. It never withdraws a review: with several merges a
# day, withdrawing and resubmitting keeps pushing the app to the back of
# Apple's queue.
def pending_review_blocks_submission?(app_id:)
  app = Spaceship::ConnectAPI::App.find(app_id)
  UI.user_error!("Could not find App Store Connect app #{app_id}") unless app

  submission = app.get_in_progress_review_submission(
    platform: Spaceship::ConnectAPI::Platform::IOS
  )
  return false unless submission

  # A rejection needs a person, so the run must not look successful.
  if submission.state == "UNRESOLVED_ISSUES"
    UI.user_error!(
      "Apple rejected the last submission. Read the message under App Review in " \
      "App Store Connect, fix it, then resubmit or remove that submission. " \
      "This build is on TestFlight."
    )
  end

  message =
    "An earlier version is still with App Review (#{submission.state}), so this " \
    "build was not submitted. It is on TestFlight."
  UI.important(message)
  puts "::warning title=Not submitted to App Review::#{message}"
  true
end
