import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fastlaneDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../fastlane'
);
const code = readFileSync(resolve(fastlaneDir, 'Fastfile'), 'utf8').replace(
  /^\s*#.*$/gm,
  ''
);
const submitLane = code.slice(code.indexOf('lane :submit do'));

interface Store {
  review?: string;
  pastSubmissions?: string[];
  editable?: boolean;
  latest?: string;
}

// Runs the real Ruby guard against a stubbed App Store Connect.
function runGuard({ review, pastSubmissions = [], editable, latest }: Store) {
  const ruby = (value?: string) => (value ? `"${value}"` : 'nil');
  const script = `
    module UI
      def self.user_error!(message); puts "FAIL #{message}"; exit 0; end
      def self.important(message); puts message; end
    end
    module Spaceship
      module ConnectAPI
        module Platform; IOS = "IOS"; end
        Submission = Struct.new(:state)
        Version = Struct.new(:app_version_state)
        class App
          def self.find(_id); new; end
          def get_in_progress_review_submission(platform:)
            ${ruby(review)} && Submission.new(${ruby(review)})
          end
          def get_review_submissions(filter:)
            # Apple can refuse a filter on a state it does not accept.
            raise "do not filter by state" if filter.key?(:state)
            %w[${pastSubmissions.join(' ')}].map { |s| Submission.new(s) }
          end
          def get_edit_app_store_version(platform:)
            ${editable ? 'Version.new("PREPARE_FOR_SUBMISSION")' : 'nil'}
          end
          def get_latest_app_store_version(platform:)
            ${ruby(latest)} && Version.new(${ruby(latest)})
          end
        end
      end
    end
    require ${JSON.stringify(resolve(fastlaneDir, 'pending_review_guard'))}
    puts "blocked=#{pending_review_blocks_submission?(app_id: "id")}"
  `;
  return execFileSync('ruby', ['-e', script], { encoding: 'utf8' });
}

const warning = '::warning title=Not submitted to App Review::';

describe('admin iOS submit lane', () => {
  it('loads the guard with fastlane import, as the storefront does', () => {
    expect(code).toContain('import("pending_review_guard.rb")');
    // Fastlane runs the Fastfile as a string, which can leave Ruby without
    // a base path for require_relative.
    expect(code).not.toContain('require_relative');
  });

  it('bugfix: never withdraws the submission already with App Review', () => {
    expect(submitLane).toContain('reject_if_possible: false');
    expect(code).not.toContain('reject_if_possible: true');
  });

  it('checks for an open submission before waiting or editing anything', () => {
    const guard = submitLane.indexOf(
      'next if pending_review_blocks_submission?'
    );
    expect(guard).toBeGreaterThan(-1);
    // Skipping must not cost a long build-processing wait first.
    expect(guard).toBeLessThan(
      submitLane.indexOf('wait_for_app_store_build_processing!(')
    );
    expect(guard).toBeLessThan(submitLane.indexOf('set_changelog('));
  });

  it('bugfix: checks again after the wait, just before editing', () => {
    // A version can reach Apple during the 40 minute processing wait.
    const recheck = submitLane.lastIndexOf(
      'next if pending_review_blocks_submission?'
    );
    expect(recheck).toBeGreaterThan(
      submitLane.indexOf('wait_for_app_store_build_processing!(')
    );
    expect(recheck).toBeLessThan(submitLane.indexOf('set_changelog('));
  });

  it('submits when the store version can still be edited', () => {
    expect(runGuard({ editable: true })).toContain('blocked=false');
  });

  it('submits the next version after the last one was published', () => {
    expect(runGuard({ latest: 'READY_FOR_DISTRIBUTION' })).toContain(
      'blocked=false'
    );
  });

  it.each([
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
  ])('skips with a visible warning while a version is %s', (review) => {
    const output = runGuard({ review, editable: true });
    expect(output).toContain(warning);
    expect(output).toContain('blocked=true');
  });

  it.each([
    'CANCELING',
    'COMPLETING',
  ])('skips while an earlier submission is still %s', (state) => {
    const output = runGuard({ pastSubmissions: ['COMPLETE', state] });
    expect(output).toContain(warning);
    expect(output).toContain(state);
    expect(output).toContain('blocked=true');
  });

  it('is not blocked by submissions that finished long ago', () => {
    expect(
      runGuard({ pastSubmissions: ['COMPLETE'], editable: true })
    ).toContain('blocked=false');
  });

  it.each([
    'ACCEPTED',
    'PENDING_DEVELOPER_RELEASE',
    'PENDING_APPLE_RELEASE',
    'PROCESSING_FOR_DISTRIBUTION',
  ])('skips while an approved version is still %s', (latest) => {
    const output = runGuard({ latest });
    expect(output).toContain(warning);
    expect(output).toContain(latest);
    expect(output).toContain('blocked=true');
  });

  it('fails the run when Apple rejected the last submission', () => {
    expect(runGuard({ review: 'UNRESOLVED_ISSUES' })).toContain(
      'FAIL Apple rejected the last submission'
    );
  });
});
