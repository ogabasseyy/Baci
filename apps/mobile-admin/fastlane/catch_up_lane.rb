platform :ios do
  # Builds nothing. Sends a build that a release run left on TestFlight because
  # an earlier version held the slot. Run by ios-admin-catch-up.yml.
  desc "Send the newest main build to App Review once the slot is free"
  lane :catch_up do
    asc_api_key # authorises Spaceship for the two checks below
    next if pending_review_blocks_submission?(app_id: BUNDLE_ID, announce: false)

    build = catch_up_candidate(app_id: BUNDLE_ID)
    next unless build

    ENV["SUBMIT_APP_VERSION"] = build.app_version
    ENV["SUBMIT_BUILD_NUMBER"] = build.build_number
    # The normal submit lane, so notes and compliance answers are the same.
    submit
  end
end
