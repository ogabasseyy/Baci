// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fastlaneDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fastlane'
);

interface TestFlightBuild {
  number: number;
  state?: string;
  expired?: boolean;
}

interface ReleaseRun {
  number: number;
  event?: string;
  branch?: string;
  status?: string;
  upload?: string;
}

interface World {
  live?: string | null;
  builds: TestFlightBuild[];
  runs?: ReleaseRun[];
  editable?: { state: string; build?: number };
  pageSize?: number;
}

const RUN_OFFSET = 30;
// A main push that uploaded TestFlight build `build`.
const mainRun = (build: number, overrides: Partial<ReleaseRun> = {}) => ({
  number: build - RUN_OFFSET,
  ...overrides,
});

// Runs the real Ruby selection against stubbed App Store Connect and GitHub.
function runCandidate({ live = '2.0.605', ...world }: World) {
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
        Build = Struct.new(:version, :processing_state, :expired, :pre_release_version)
        Version = Struct.new(:version_string, :app_version_state, :build)
        # One page of results; all_pages follows the rest, as Spaceship does.
        class Response
          def initialize(pages); @pages = pages; end
          def to_models; @pages.first || []; end
          def all_pages; @pages.map { |page| Response.new([page]) }; end
        end
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
        def self.get_builds(filter:, includes:, limit:, sort:)
          raise "wrong app" unless filter[:app] == "app-id"
          raise "newest first" unless sort == "-uploadedDate"
          raise "version not included" unless includes.include?("preReleaseVersion")
          builds = WORLD["builds"].map do |b|
            Build.new(b["number"].to_s, b["state"] || "VALID", b["expired"] || false,
                      PreRelease.new("2.0.#{b['number']}", "IOS"))
          end
          Response.new(builds.each_slice(WORLD["pageSize"] || limit).to_a)
        end
      end
    end
    require ${JSON.stringify(resolve(fastlaneDir, 'main_release_runs'))}
    require ${JSON.stringify(resolve(fastlaneDir, 'catch_up_candidate'))}
    def github_api(path)
      runs = WORLD["runs"]
      if path.start_with?("actions/workflows/ios-release.yml/runs")
        { "workflow_runs" => runs.map do |r|
          { "id" => r["number"], "run_number" => r["number"],
            "event" => r["event"] || "push", "head_branch" => r["branch"] || "main",
            "status" => r["status"] || "completed" }
        end }
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
      WORLD: JSON.stringify({ ...world, live, runs }),
    },
  });
}

describe('admin iOS catch-up: which build to send', () => {
  it('sends the newest main build that is newer than the live version', () => {
    const output = runCandidate({
      builds: [{ number: 606 }, { number: 609 }, { number: 607 }],
    });
    expect(output).toContain('send=2.0.609 build=609');
  });

  it('does nothing when nothing is newer than the live version', () => {
    const output = runCandidate({
      live: '2.0.609',
      builds: [{ number: 609 }, { number: 605 }],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('nothing newer than 2.0.609');
  });

  it('never sends an expired build or one Apple could not process', () => {
    const output = runCandidate({
      builds: [
        { number: 609, expired: true },
        { number: 608, state: 'INVALID' },
        { number: 607, state: 'FAILED' },
        { number: 606 },
      ],
    });
    expect(output).toContain('build=606');
  });

  it('only sends builds a push to main uploaded', () => {
    const output = runCandidate({
      builds: [610, 609, 608, 607, 606, 611].map((number) => ({ number })),
      runs: [
        mainRun(610, {
          event: 'workflow_dispatch',
          branch: 'codex/experiment',
        }),
        mainRun(609, { branch: 'v609-admin-ios' }),
        // Manual runs stay TestFlight-only, as in a normal release.
        mainRun(608, { event: 'workflow_dispatch' }),
        mainRun(607, { upload: 'failure' }),
        mainRun(606),
        // 611 has no release run at all (a local or EAS upload).
      ],
    });
    expect(output).toContain('build=606');
  });

  it('finds a main build behind a full page of uploads from elsewhere', () => {
    const output = runCandidate({
      pageSize: 2,
      builds: [{ number: 609 }, { number: 608 }, { number: 607 }],
      runs: [mainRun(607)],
    });
    expect(output).toContain('build=607');
  });

  it('waits rather than sending an older build while the newest processes', () => {
    const output = runCandidate({
      builds: [{ number: 607, state: 'PROCESSING' }, { number: 606 }],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('607 is still processing');
  });

  it.each([
    'queued',
    'in_progress',
  ])('leaves it to a release run that is still %s', (status) => {
    const output = runCandidate({
      builds: [{ number: 606 }],
      runs: [mainRun(607, { status }), mainRun(606)],
    });
    expect(output).toContain('send=none');
    expect(output).toContain('A release run is still going');
  });

  it('is not held up by a manual branch run, which never submits', () => {
    const output = runCandidate({
      builds: [{ number: 606 }],
      runs: [
        mainRun(607, {
          event: 'workflow_dispatch',
          branch: 'codex/experiment',
          status: 'in_progress',
        }),
        mainRun(606),
      ],
    });
    expect(output).toContain('build=606');
  });

  it.each([
    'REJECTED',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
    'INVALID_BINARY',
  ])('does not resend a build left %s, nor an older one', (state) => {
    const output = runCandidate({
      builds: [{ number: 607 }, { number: 606 }],
      editable: { state, build: 607 },
    });
    expect(output).toContain('send=none');
    expect(output).toContain(state);
  });

  it('sends nothing older than a turned-down build from elsewhere', () => {
    const output = runCandidate({
      builds: [{ number: 610 }, { number: 607 }],
      runs: [mainRun(607)],
      editable: { state: 'REJECTED', build: 610 },
    });
    expect(output).toContain('send=none');
    expect(output).toContain('build 610 is REJECTED');
  });

  it('does not put an older build in place of an invalid binary', () => {
    const output = runCandidate({
      builds: [{ number: 608, state: 'INVALID' }, { number: 607 }],
      editable: { state: 'INVALID_BINARY', build: 608 },
    });
    expect(output).toContain('send=none');
  });

  it('still sends when the rejected version has no build attached', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      editable: { state: 'REJECTED' },
    });
    expect(output).toContain('build=607');
  });

  it('sends a newer build after an earlier one was rejected', () => {
    const output = runCandidate({
      builds: [{ number: 608 }, { number: 607 }],
      editable: { state: 'REJECTED', build: 607 },
    });
    expect(output).toContain('build=608');
  });

  it('retries a build whose earlier submission never finished', () => {
    const output = runCandidate({
      builds: [{ number: 607 }],
      editable: { state: 'PREPARE_FOR_SUBMISSION', build: 607 },
    });
    expect(output).toContain('build=607');
  });

  it('fails visibly when there is no live version to compare with', () => {
    const output = runCandidate({ live: null, builds: [{ number: 607 }] });
    expect(output).toContain('FAIL Could not find the live iOS version');
  });
});
