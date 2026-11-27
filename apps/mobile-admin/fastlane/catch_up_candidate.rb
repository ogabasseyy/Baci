# Chooses the build the scheduled check sends: the newest valid, unexpired
# TestFlight build that a push to main uploaded and that is newer than the live
# version. It only reads; the submit lane does the sending.

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

def catch_up_candidate(app_id:)
  app = Spaceship::ConnectAPI::App.find(app_id)
  UI.user_error!("Could not find App Store Connect app #{app_id}") unless app
  platform = Spaceship::ConnectAPI::Platform::IOS

  live = app.get_live_app_store_version(platform: platform)
  UI.user_error!("Could not find the live iOS version to compare with") unless live

  runs = recent_release_runs
  return skip_catch_up("A release run is still going and submits its own build.") if release_run_active?(runs)

  build = newest_main_build(app, runs, newer_than: live.version_string)
  return skip_catch_up("nothing newer than #{live.version_string} from main is on TestFlight.") unless build
  return skip_catch_up("build #{build.version} is still processing.") if build.processing_state == "PROCESSING"

  editable = app.get_edit_app_store_version(platform: platform)
  if editable && TURNED_DOWN_VERSION_STATES.include?(editable.app_version_state) &&
     editable.build&.version == build.version
    return skip_catch_up(
      "build #{build.version} is #{editable.app_version_state}. Resubmit it by hand, " \
      "or the next newer build will be sent."
    )
  end

  app_version = build.pre_release_version.version
  report_catch_up("Sending #{app_version} (build #{build.version}) to App Review.")
  CatchUpBuild.new(app_version, build.version)
end

# Newest first. A build still processing is returned too, so that an older one
# does not overtake it.
def newest_main_build(app, runs, newer_than:)
  floor = Gem::Version.new(newer_than)
  builds = Spaceship::ConnectAPI.get_builds(
    filter: { app: app.id, expired: "false", processingState: "PROCESSING,FAILED,INVALID,VALID" },
    includes: "preReleaseVersion",
    sort: "-uploadedDate",
    limit: 50
  ).to_models

  builds
    .select { |build| newer_ios_build?(build, floor) }
    .sort_by { |build| [Gem::Version.new(build.pre_release_version.version), build.version.to_i] }
    .reverse
    .find { |build| uploaded_from_main?(runs, build.version.to_i) }
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
