# Chooses the build the scheduled check sends: the one the latest release from
# main uploaded, if it is usable and newer than the live version. It never falls
# back to an older build. It only reads; the submit lane does the sending.

# Apple or a person turned the attached build down, so a person decides.
TURNED_DOWN_VERSION_STATES = %w[
  DEVELOPER_REJECTED
  REJECTED
  METADATA_REJECTED
  INVALID_BINARY
].freeze

CatchUpBuild = Struct.new(:app_version, :build_number)

def report_catch_up(message)
  UI.message(message)
  puts "::notice title=App Store catch-up::#{message}"
end

def skip_catch_up(reason)
  report_catch_up("Nothing sent: #{reason}")
  nil
end

# Builds are ordered by marketing version, then build number.
def release_order(app_version, build_number)
  [Gem::Version.new(app_version), Gem::Version.new(build_number)]
end

# A turned down build is not sent again, and nothing older goes out in its
# place, whoever uploaded it.
def turned_down_blocks?(editable, build)
  return false unless editable&.build && TURNED_DOWN_VERSION_STATES.include?(editable.app_version_state)

  candidate = release_order(build.pre_release_version.version, build.version)
  (candidate <=> release_order(editable.version_string, editable.build.version)) <= 0
end

def catch_up_candidate(app_id:)
  app = Spaceship::ConnectAPI::App.find(app_id)
  UI.user_error!("Could not find App Store Connect app #{app_id}") unless app
  platform = Spaceship::ConnectAPI::Platform::IOS

  live = app.get_live_app_store_version(platform: platform)
  UI.user_error!("Could not find the live iOS version to compare with") unless live

  runs = recent_release_runs
  # Checked once, with no lock. A push landing after this ends like one landing
  # just after we submit: its release run finds the slot held, and a later check
  # sends its build once the slot is free.
  return skip_catch_up("A release run is still going and submits its own build.") if release_run_active?(runs)

  run = latest_main_release_run(runs)
  return skip_catch_up("no release from main was found.") unless run

  app_version = released_app_version(run)
  number = released_build_number(run).to_s
  unless Gem::Version.new(app_version) > Gem::Version.new(live.version_string)
    return skip_catch_up("nothing newer than #{live.version_string} from main (latest: #{app_version}).")
  end
  unless run_uploaded?(run)
    return skip_catch_up("the latest release from main did not upload build #{number}. Re-run or fix it.")
  end

  build = testflight_build(app, app_version, number)
  return skip_catch_up("build #{number} is not usable on TestFlight (unlisted, expired or invalid).") unless build
  return skip_catch_up("build #{number} is still processing.") if build.processing_state == "PROCESSING"

  editable = app.get_edit_app_store_version(platform: platform)
  if turned_down_blocks?(editable, build)
    return skip_catch_up(
      "build #{editable.build.version} is #{editable.app_version_state}, so nothing as old " \
      "is sent. Resubmit it by hand, or the next newer build will be sent."
    )
  end

  report_catch_up("Sending #{app_version} (build #{number}) to App Review.")
  CatchUpBuild.new(app_version, number)
end

# That one build, unless Apple cannot take it.
def testflight_build(app, app_version, build_number)
  Spaceship::ConnectAPI::Build.all(
    app_id: app.id, version: app_version, build_number: build_number,
    platform: Spaceship::ConnectAPI::Platform::IOS
  ).find { |build| !build.expired && %w[VALID PROCESSING].include?(build.processing_state) }
end
