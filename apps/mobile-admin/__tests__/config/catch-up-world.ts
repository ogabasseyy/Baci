// Runs the real catch-up selection (Ruby) against a fake App Store and GitHub.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fastlaneDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fastlane'
);

export interface TestFlightBuild {
  number: number;
  version?: string;
  state?: string;
  expired?: boolean;
}

export interface ReleaseRun {
  number: number;
  event?: string;
  branch?: string;
  status?: string;
  upload?: string;
  // The release workflow's <major>.<minor> at this run's commit, if it differs.
  majorMinor?: string;
}

export interface World {
  live?: string | null;
  builds: TestFlightBuild[];
  // Newest first, as GitHub lists them.
  runs?: ReleaseRun[];
  editable?: { state: string; build?: number };
  // The release workflow as it stood at each run's commit.
  releaseWorkflow?: string;
}

const RUN_OFFSET = 30;

// A main push that uploaded TestFlight build `build`.
export const mainRun = (
  build: number,
  overrides: Partial<ReleaseRun> = {}
) => ({
  number: build - RUN_OFFSET,
  ...overrides,
});

export function runCandidate({
  live = '2.0.605',
  releaseWorkflow = "env:\n  APP_VERSION_MAJOR_MINOR: '2.0'\n",
  ...world
}: World) {
  const script = `
    require "json"
    WORLD = JSON.parse(ENV.fetch("WORLD"))
    module UI
      def self.user_error!(message); puts "FAIL #{message}"; exit 0; end
      def self.important(message); puts message; end
      def self.message(message); puts message; end
    end
    module Spaceship
      module ConnectAPI
        module Platform; IOS = "IOS"; end
        PreRelease = Struct.new(:version, :platform)
        Build = Struct.new(:version, :processing_state, :expired, :pre_release_version) do
          # As the real lookup: one marketing version and build number.
          def self.all(app_id:, version:, build_number:, platform:)
            raise "wrong app" unless app_id == "app-id"
            listed = WORLD["builds"].map do |b|
              new(b["number"].to_s, b["state"] || "VALID", b["expired"] || false,
                  PreRelease.new(b["version"] || "2.0.#{b['number']}", "IOS"))
            end
            listed.select do |build|
              build.version == build_number && build.pre_release_version.version == version &&
                build.pre_release_version.platform == platform
            end
          end
        end
        Version = Struct.new(:version_string, :app_version_state, :build)
        class App
          def self.find(_id); new; end
          def id; "app-id"; end
          def get_live_app_store_version(platform:)
            WORLD["live"] && Version.new(WORLD["live"])
          end
          def get_edit_app_store_version(platform:)
            e = WORLD["editable"]
            e && Version.new("2.0.#{e['build']}", e["state"], e["build"] && Build.new(e["build"].to_s))
          end
        end
      end
    end
    require ${JSON.stringify(resolve(fastlaneDir, 'main_release_runs'))}
    require ${JSON.stringify(resolve(fastlaneDir, 'catch_up_candidate'))}
    def github_api(path)
      runs = WORLD["runs"]
      if path.start_with?("actions/workflows/ios-release.yml/runs")
        size = path[/per_page=(\\d+)/, 1].to_i
        page = (path[/[?&]page=(\\d+)/, 1] || "1").to_i
        puts "runs page #{page}"
        { "workflow_runs" => (runs.each_slice(size).to_a[page - 1] || []).map do |r|
          { "id" => r["number"], "run_number" => r["number"],
            "head_sha" => "sha-#{r['number']}",
            "event" => r["event"] || "push", "head_branch" => r["branch"] || "main",
            "status" => r["status"] || "completed" }
        end }
      elsif path.start_with?("contents/")
        unless path.match?(%r{\\Acontents/\\.github/workflows/ios-release\\.yml\\?ref=sha-\\d+\\z})
          raise "wrong file: #{path}"
        end
        own = runs.find { |r| path.end_with?("ref=sha-#{r['number']}") }["majorMinor"]
        line = own && "env:\\n  APP_VERSION_MAJOR_MINOR: '#{own}'\\n"
        { "content" => line ? [line].pack("m") : WORLD["releaseWorkflowBase64"] }
      else
        id = path[%r{actions/runs/(\\d+)/jobs}, 1].to_i
        run = runs.find { |r| r["number"] == id }
        steps = [{ "name" => "Fastlane release", "conclusion" => run["upload"] || "success" }]
        { "jobs" => [{ "steps" => steps }] }
      end
    end
    build = catch_up_candidate(app_id: "id")
    puts(build ? "send=#{build.app_version} build=#{build.build_number}" : "send=none")
  `;
  const runs = world.runs ?? world.builds.map((b) => mainRun(b.number));
  return execFileSync('ruby', ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BUILD_NUMBER_BASE: String(RUN_OFFSET),
      WORLD: JSON.stringify({
        ...world,
        live,
        runs,
        releaseWorkflowBase64: Buffer.from(releaseWorkflow).toString('base64'),
      }),
    },
  });
}
