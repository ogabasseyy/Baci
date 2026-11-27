# Chooses the build the scheduled check sends: the newest valid, unexpired
# TestFlight build that a push to main uploaded, that is newer than the live
# version and that no later push to main has overtaken. It only reads; the
# submit lane does the sending.

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

  build = newest_main_build(app, runs, newer_than: live.version_string)
  return skip_catch_up("nothing newer than #{live.version_string} from main is on TestFlight.") unless build

  if overtaken_on_main?(runs, build.version.to_i)
    return skip_catch_up(
      "build #{build.version} is out of date: a later release from main has no build " \
      "to send. Re-run or fix that release."
    )
  end
  return skip_catch_up("build #{build.version} is still processing.") if build.processing_state == "PROCESSING"

  editable = app.get_edit_app_store_version(platform: platform)
  if turned_down_blocks?(editable, build)
    return skip_catch_up(
      "build #{editable.build.version} is #{editable.app_version_state}, so nothing as old " \
      "is sent. Resubmit it by hand, or the next newer build will be sent."
    )
  end

  app_version = build.pre_release_version.version
  report_catch_up("Sending #{app_version} (build #{build.version}) to App Review.")
  CatchUpBuild.new(app_version, build.version)
end

# Newest first. A build still processing is returned too, so that an older one
# does not overtake it. Every page is read, so that newer uploads from elsewhere
# cannot hide a main build.
def newest_main_build(app, runs, newer_than:)
  floor = Gem::Version.new(newer_than)
  builds = Spaceship::ConnectAPI.get_builds(
    filter: { app: app.id, expired: "false", processingState: "PROCESSING,FAILED,INVALID,VALID" },
    includes: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: 200
  ).all_pages.flat_map(&:to_models)

  builds
    .select { |build| newer_ios_build?(build, floor) }
    .sort_by { |build| release_order(build.pre_release_version.version, build.version) }
    .reverse
    .find do |build|
      uploaded_from_main?(runs, build.pre_release_version.version, build.version.to_i)
    end
end

# FAILED and INVALID builds can never be sent, so they are passed over.
def newer_ios_build?(build, floor)
  release = build.pre_release_version
  !build.expired &&
    %w[VALID PROCESSING].include?(build.processing_state) &&
    !release.nil? && release.platform == "IOS" &&
    Gem::Version.correct?(release.version) && Gem::Version.new(release.version) > floor &&
    build.version.to_s.match?(/\A\d+\z/)
end
