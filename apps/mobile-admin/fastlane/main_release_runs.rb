# Which TestFlight builds a push to main uploaded. App Store Connect does not
# record a build's branch, so GitHub's history of release runs is asked.
require "json"
require "net/http"

RELEASE_WORKFLOW_FILE = "ios-release.yml"
# The step of that workflow whose success means the build reached TestFlight.
RELEASE_UPLOAD_STEP = "Fastlane release"

# Failures name the status and path only, never the token or the response body.
def github_api(path)
  uri = URI("https://api.github.com/repos/#{ENV.fetch('GITHUB_REPOSITORY')}/#{path}")
  request = Net::HTTP::Get.new(uri)
  request["Accept"] = "application/vnd.github+json"
  request["Authorization"] = "Bearer #{ENV.fetch('GITHUB_TOKEN')}"
  response = Net::HTTP.start(uri.host, uri.port, use_ssl: true) do |http|
    http.request(request)
  end
  UI.user_error!("GitHub returned #{response.code} for #{path}") unless response.code == "200"
  JSON.parse(response.body)
end

# The newest runs only: weeks of history, far more than the gap between the
# live version and the newest build.
def recent_release_runs
  github_api("actions/workflows/#{RELEASE_WORKFLOW_FILE}/runs?per_page=100")
    .fetch("workflow_runs")
end

# A push run (main or a release tag) submits its own build when it gets there.
# Manual runs never submit.
def release_run_active?(runs)
  runs.any? { |run| run["event"] == "push" && run["status"] != "completed" }
end

# Manual runs are left out, as a normal release leaves them on TestFlight, and
# because a build number override would break the run number arithmetic.
def uploaded_from_main?(runs, build_number)
  run_number = build_number - Integer(ENV.fetch("BUILD_NUMBER_BASE"), 10)
  run = runs.find do |candidate|
    candidate["event"] == "push" &&
      candidate["head_branch"] == "main" &&
      candidate["run_number"] == run_number
  end
  return false unless run

  # Every attempt: a failed re-run does not undo an earlier upload.
  github_api("actions/runs/#{run['id']}/jobs?filter=all&per_page=100")
    .fetch("jobs")
    .flat_map { |job| job.fetch("steps", []) }
    .any? { |step| step["name"] == RELEASE_UPLOAD_STEP && step["conclusion"] == "success" }
end
