# What the release from main uploaded. App Store Connect does not record a
# build's branch, so GitHub's history of release runs is asked.
require "json"
require "net/http"

RELEASE_WORKFLOW_FILE = "ios-release.yml"
# The step of that workflow whose success means the build reached TestFlight.
RELEASE_UPLOAD_STEP = "Fastlane release"
RELEASE_RUNS_PER_PAGE = 100
# Its <major>.<minor>: a run names its build's version this plus the build number.
RELEASE_VERSION_LINE = /^  APP_VERSION_MAJOR_MINOR: '(\d+\.\d+)'/

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

# One page of release runs, newest first.
def release_runs_page(page)
  query = "per_page=#{RELEASE_RUNS_PER_PAGE}&page=#{page}"
  github_api("actions/workflows/#{RELEASE_WORKFLOW_FILE}/runs?#{query}")
    .fetch("workflow_runs")
end

# The newest runs, where any release still going is.
def recent_release_runs
  release_runs_page(1)
end

# A push run (main or a release tag) submits its own build when it gets there.
# Manual runs never submit.
def release_run_active?(runs)
  runs.any? { |run| run["event"] == "push" && run["status"] != "completed" }
end

def main_push?(run)
  run["event"] == "push" && run["head_branch"] == "main"
end

# The latest release from main. The release workflow withholds anything older as
# stale, so only this run's build may be sent. Manual runs are left out, as a
# normal release leaves them on TestFlight. Older pages are read until a push to
# main turns up.
def latest_main_release_run(runs)
  page = 1
  until runs.empty?
    latest = runs.select { |run| main_push?(run) }.max_by { |run| run["run_number"] }
    return latest if latest

    page += 1
    runs = release_runs_page(page)
  end
  nil
end

# The build number that run gave its upload. A push cannot override it.
def released_build_number(run)
  run["run_number"] + Integer(ENV.fetch("BUILD_NUMBER_BASE"), 10)
end

# The version it gave that build, from the workflow as it stood at its commit.
# Apple tells builds apart by version and number together.
def released_app_version(run)
  file = github_api("contents/.github/workflows/#{RELEASE_WORKFLOW_FILE}?ref=#{run['head_sha']}")
  major_minor = file.fetch("content").unpack1("m")[RELEASE_VERSION_LINE, 1]
  unless major_minor
    UI.user_error!("Could not read APP_VERSION_MAJOR_MINOR for release run #{run['run_number']}")
  end
  "#{major_minor}.#{released_build_number(run)}"
end

# Every attempt: a failed re-run does not undo an earlier upload.
def run_uploaded?(run)
  github_api("actions/runs/#{run['id']}/jobs?filter=all&per_page=100")
    .fetch("jobs")
    .flat_map { |job| job.fetch("steps", []) }
    .any? { |step| step["name"] == RELEASE_UPLOAD_STEP && step["conclusion"] == "success" }
end
